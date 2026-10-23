import { randomUUID } from "node:crypto";
import type {
  Anchor,
  DocumentPayload,
  ProposalRecord,
  ProposalView,
  SentScope,
  ThreadMode,
  ThreadRecord,
  ThreadView,
  Turn,
} from "../../shared/schemas.ts";
import { StudioError } from "../errors.ts";
import type { Store, StoreData } from "../persistence/store.ts";
import { AiError, type AiAdapter, type AiInput } from "../providers/ai-adapter.ts";
import { extractSurroundingContext } from "./context.ts";
import type { DocumentService } from "./documents.ts";

export const MAX_TURNS_SENT = 8;

export type ThreadService = ReturnType<typeof createThreadService>;

export function createThreadService({
  store,
  documents,
  adapter,
  now = () => new Date().toISOString(),
}: {
  store: Store;
  documents: DocumentService;
  adapter: AiAdapter | null;
  now?: () => string;
}) {
  const inFlight = new Set<string>();

  function view(data: StoreData, thread: ThreadRecord, currentHash: string | null): ThreadView {
    const stale = currentHash === null || currentHash !== thread.anchor.sourceDocumentHash;
    return {
      ...thread,
      status: stale ? "stale" : thread.decision,
      insights: data.insights.filter((insight) => insight.threadId === thread.id),
      proposals: data.proposals
        .filter((proposal) => proposal.threadId === thread.id)
        .map((proposal) => proposalView(proposal, currentHash)),
    };
  }

  function proposalView(proposal: ProposalRecord, currentHash: string | null): ProposalView {
    const stale =
      proposal.status === "pending" &&
      (currentHash === null || currentHash !== proposal.anchor.sourceDocumentHash);
    return { ...proposal, status: stale ? "stale" : proposal.status };
  }

  async function currentDocument(documentPath: string): Promise<DocumentPayload | null> {
    try {
      return await documents.read(documentPath);
    } catch (error) {
      if (error instanceof StudioError && error.code === "not_found") return null;
      throw error;
    }
  }

  function findThread(data: StoreData, threadId: string): ThreadRecord {
    const thread = data.threads.find((candidate) => candidate.id === threadId);
    if (!thread) throw new StudioError("not_found", "対話が見つかりません", 404);
    return thread;
  }

  async function threadView(threadId: string): Promise<ThreadView> {
    const data = store.snapshot();
    const thread = findThread(data, threadId);
    const document = await currentDocument(thread.documentPath);
    return view(data, thread, document?.contentHash ?? null);
  }

  async function list(documentPath: string): Promise<ThreadView[]> {
    const document = await documents.read(documentPath);
    const data = store.snapshot();
    return data.threads
      .filter((thread) => thread.documentPath === document.path)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((thread) => view(data, thread, document.contentHash));
  }

  async function create(documentPath: string, anchor: Anchor, mode: ThreadMode): Promise<ThreadView> {
    const document = await documents.read(documentPath);
    if (anchor.quote.trim() === "") {
      throw new StudioError("invalid_request", "空白だけの選択では尋ねられません", 400);
    }
    if (
      document.contentHash !== anchor.sourceDocumentHash ||
      document.content.slice(anchor.start, anchor.end) !== anchor.quote
    ) {
      throw new StudioError(
        "stale_selection",
        "保存済みの原稿と選択箇所が一致しません。保存してから選択し直してください",
        409,
      );
    }
    const timestamp = now();
    const thread: ThreadRecord = {
      id: randomUUID(),
      documentPath: document.path,
      anchor,
      mode,
      decision: "open",
      turns: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await store.update((draft) => {
      draft.threads.push(thread);
    });
    return threadView(thread.id);
  }

  // AIを呼ぶ前提を確かめ、送る内容を組み立てる。
  async function prepareAiCall(threadId: string) {
    if (!adapter) {
      throw new StudioError(
        "ai_not_configured",
        "AIが設定されていません。OPENAI_API_KEY と JP_DOCS_STUDIO_MODEL を設定してから起動し直してください",
        503,
      );
    }
    const data = store.snapshot();
    const thread = findThread(data, threadId);
    if (thread.decision === "dismissed") {
      throw new StudioError("dismissed", "却下した対話です。再開してから尋ねてください", 409);
    }
    const document = await currentDocument(thread.documentPath);
    if (!document || document.contentHash !== thread.anchor.sourceDocumentHash) {
      throw new StudioError(
        "stale_thread",
        "原稿が変更されたため、この対話の位置は古くなっています。選択し直してください",
        409,
      );
    }
    if (inFlight.has(threadId)) {
      throw new StudioError("busy", "AIの応答を待っています", 409);
    }
    const surroundingContext = extractSurroundingContext(document.content, thread.anchor.start, thread.anchor.end);
    const turns = thread.turns.slice(-MAX_TURNS_SENT).map((turn) => ({ role: turn.role, text: turn.text }));
    return { adapter, thread, surroundingContext, turns };
  }

  function sentScope(adapterInUse: AiAdapter, input: AiInput): SentScope {
    return {
      provider: adapterInUse.provider,
      model: adapterInUse.model,
      selectionChars: input.selection.length,
      contextChars: input.surroundingContext.length,
      turns: input.turns.length,
    };
  }

  async function callAdapter(threadId: string, adapterInUse: AiAdapter, input: AiInput) {
    inFlight.add(threadId);
    try {
      return await adapterInUse.respond(input);
    } catch (error) {
      if (error instanceof AiError) throw new StudioError(`ai_${error.code}`, error.message, 502);
      throw new StudioError("ai_provider", "AIの呼び出しに失敗しました", 502);
    } finally {
      inFlight.delete(threadId);
    }
  }

  async function assist(threadId: string): Promise<{ thread: ThreadView; sent: SentScope }> {
    const { adapter: adapterInUse, thread, surroundingContext, turns } = await prepareAiCall(threadId);
    const lastTurn = thread.turns.at(-1);
    const hasAiTurn = thread.turns.some((turn) => turn.role === "ai");
    if (hasAiTurn && lastTurn?.role !== "author") {
      throw new StudioError("awaiting_author", "AIの問いに返答してから続けてください", 409);
    }
    const input: AiInput = {
      action: hasAiTurn ? "reply" : thread.mode,
      selection: thread.anchor.quote,
      surroundingContext,
      turns,
      ...(hasAiTurn && lastTurn ? { authorReply: lastTurn.text } : {}),
    };
    const output = await callAdapter(threadId, adapterInUse, input);
    if (output.kind !== "reflection") {
      throw new StudioError("ai_invalid_response", "AIの応答が想定した形式ではありませんでした", 502);
    }
    const reflection = {
      interpretation: output.interpretation,
      reasoning: output.reasoning,
      question: output.question,
      ...(output.uncertainty ? { uncertainty: output.uncertainty } : {}),
    };
    const turn: Turn = {
      id: randomUUID(),
      role: "ai",
      text: [
        `読み: ${reflection.interpretation}`,
        `理由: ${reflection.reasoning}`,
        `問い: ${reflection.question}`,
        ...(reflection.uncertainty ? [`判断できないこと: ${reflection.uncertainty}`] : []),
      ].join("\n"),
      createdAt: now(),
      reflection,
    };
    await store.update((draft) => {
      const target = findThread(draft, threadId);
      target.turns.push(turn);
      target.updatedAt = turn.createdAt;
    });
    return { thread: await threadView(threadId), sent: sentScope(adapterInUse, input) };
  }

  async function addAuthorTurn(threadId: string, text: string): Promise<ThreadView> {
    const trimmed = text.trim();
    if (trimmed === "") throw new StudioError("invalid_request", "返答が空です", 400);
    findThread(store.snapshot(), threadId);
    const turn: Turn = { id: randomUUID(), role: "author", text: trimmed, createdAt: now() };
    await store.update((draft) => {
      const target = findThread(draft, threadId);
      target.turns.push(turn);
      target.updatedAt = turn.createdAt;
    });
    return threadView(threadId);
  }

  async function decide(threadId: string, decision: "held" | "dismissed" | "reopened"): Promise<ThreadView> {
    await store.update((draft) => {
      const target = findThread(draft, threadId);
      target.decision = decision === "reopened" ? "open" : decision;
      target.updatedAt = now();
    });
    return threadView(threadId);
  }

  // 気づきは書き手が入力した文だけを保存する。AIの応答から自動では作らない。
  async function addInsight(threadId: string, text: string): Promise<ThreadView> {
    const trimmed = text.trim();
    if (trimmed === "") throw new StudioError("invalid_request", "気づきが空です", 400);
    await store.update((draft) => {
      findThread(draft, threadId);
      draft.insights.push({ id: randomUUID(), threadId, text: trimmed, createdAt: now() });
    });
    return threadView(threadId);
  }

  async function propose(threadId: string): Promise<{ thread: ThreadView; proposal: ProposalView; sent: SentScope }> {
    const { adapter: adapterInUse, thread, surroundingContext, turns } = await prepareAiCall(threadId);
    const input: AiInput = {
      action: "propose",
      selection: thread.anchor.quote,
      surroundingContext,
      turns,
    };
    const output = await callAdapter(threadId, adapterInUse, input);
    if (output.kind !== "proposal") {
      throw new StudioError("ai_invalid_response", "AIの修正案が想定した形式ではありませんでした", 502);
    }
    const proposal: ProposalRecord = {
      id: randomUUID(),
      threadId,
      documentPath: thread.documentPath,
      anchor: thread.anchor,
      replacementText: output.replacementText,
      rationale: output.rationale,
      status: "pending",
      createdAt: now(),
    };
    await store.update((draft) => {
      draft.proposals.push(proposal);
    });
    const updated = await threadView(threadId);
    const created = updated.proposals.find((candidate) => candidate.id === proposal.id);
    if (!created) throw new StudioError("internal", "修正案を保存できませんでした", 500);
    return { thread: updated, proposal: created, sent: sentScope(adapterInUse, input) };
  }

  async function decideProposal(
    proposalId: string,
    decision: "accepted" | "rejected",
    expectedHash: string,
  ): Promise<{ proposal: ProposalView; thread: ThreadView; document?: DocumentPayload }> {
    const data = store.snapshot();
    const proposal = data.proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal) throw new StudioError("not_found", "修正案が見つかりません", 404);
    if (proposal.status !== "pending") {
      throw new StudioError("already_decided", "この修正案はすでに判断済みです", 409);
    }

    let document: DocumentPayload | undefined;
    if (decision === "accepted") {
      if (expectedHash !== proposal.anchor.sourceDocumentHash) {
        throw new StudioError("stale_proposal", "元の文章が変更されています。選択し直してください", 409);
      }
      document = await documents.replaceRange(proposal.documentPath, proposal.anchor, proposal.replacementText);
    }
    const decidedAt = now();
    await store.update((draft) => {
      const target = draft.proposals.find((candidate) => candidate.id === proposalId);
      if (!target) throw new StudioError("not_found", "修正案が見つかりません", 404);
      target.status = decision;
      target.decidedAt = decidedAt;
      if (document) target.appliedDocumentHash = document.contentHash;
    });
    const thread = await threadView(proposal.threadId);
    const updated = thread.proposals.find((candidate) => candidate.id === proposalId);
    if (!updated) throw new StudioError("internal", "修正案を保存できませんでした", 500);
    return { proposal: updated, thread, ...(document ? { document } : {}) };
  }

  return { list, create, assist, addAuthorTurn, decide, addInsight, propose, decideProposal, threadView };
}
