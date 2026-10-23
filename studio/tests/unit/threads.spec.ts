import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { StudioError } from "../../src/server/errors.ts";
import { hashContent } from "../../src/server/hash.ts";
import { openStore } from "../../src/server/persistence/store.ts";
import { AiError } from "../../src/server/providers/ai-adapter.ts";
import { SELECTION_MARKER } from "../../src/server/services/context.ts";
import { createDocumentService } from "../../src/server/services/documents.ts";
import { createThreadService } from "../../src/server/services/threads.ts";
import { createFakeAdapter } from "../fixtures/fake-adapter.ts";
import { makeTempDirs, writeFile } from "../fixtures/temp.ts";

const TEXT = [
  "# 文章を書くということ",
  "",
  "遠く離れた段落。ここは送られてはいけない。",
  "",
  "私は、AIとの対話を通じて自分の考えが明確になることに価値を感じている。",
  "",
  "しかし、AIと対話することが、いつも思考を深めるとは限らない。",
  "",
  "では、どのような対話に価値があるのだろうか。",
  "",
  "最後の段落。ここも送られてはいけない。",
  "",
].join("\n");
const QUOTE = "しかし、AIと対話することが、いつも思考を深めるとは限らない。";

async function setup({ withAdapter = true } = {}) {
  const { workspace, data } = await makeTempDirs();
  const file = await writeFile(workspace, "a.md", TEXT);
  const store = await openStore(data, workspace);
  const documents = createDocumentService(workspace);
  const adapter = createFakeAdapter();
  const threads = createThreadService({ store, documents, adapter: withAdapter ? adapter : null });
  const start = TEXT.indexOf(QUOTE);
  const anchor = { quote: QUOTE, start, end: start + QUOTE.length, sourceDocumentHash: hashContent(TEXT) };
  return { workspace, data, file, store, documents, adapter, threads, anchor };
}

const isCode = (code: string) => (error: unknown) => error instanceof StudioError && error.code === code;

describe("選択箇所からの対話", () => {
  it("B-01: 選択と前後の限定文脈だけを送り、解釈と問いを1件返す", async () => {
    const { threads, adapter, anchor } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    const { thread: answered, sent } = await threads.assist(thread.id);

    assert.equal(adapter.calls.length, 1);
    const input = adapter.calls[0];
    assert.ok(input);
    assert.equal(input.action, "interpret");
    assert.equal(input.selection, QUOTE);
    assert.ok(input.surroundingContext.includes(SELECTION_MARKER));
    assert.ok(input.surroundingContext.includes("私は、AIとの対話を通じて"));
    assert.ok(input.surroundingContext.includes("では、どのような対話"));
    assert.ok(!input.surroundingContext.includes("遠く離れた段落"));
    assert.ok(!input.surroundingContext.includes("最後の段落"));
    assert.ok(!input.surroundingContext.includes(QUOTE), "選択箇所そのものは文脈へ重複させない");

    const turn = answered.turns.at(-1);
    assert.equal(turn?.role, "ai");
    assert.ok(turn?.reflection?.interpretation);
    assert.ok(turn?.reflection?.question);
    assert.equal(sent.selectionChars, QUOTE.length);
    assert.equal(sent.turns, 0);
  });

  it("B-02: 原稿の作成・保存・対話の作成だけではAIを呼ばない", async () => {
    const { threads, documents, adapter, anchor } = await setup();
    const created = await documents.create("new.md", "書いている途中");
    await documents.save("new.md", "書いている途中。続き。", created.contentHash);
    await threads.create("a.md", anchor, "interpret");
    assert.equal(adapter.calls.length, 0);
  });

  it("A-04: AI未設定では、偽の回答を返さず設定が必要と伝える", async () => {
    const { threads, anchor } = await setup({ withAdapter: false });
    const thread = await threads.create("a.md", anchor, "interpret");
    await assert.rejects(threads.assist(thread.id), isCode("ai_not_configured"));
    await assert.rejects(threads.propose(thread.id), isCode("ai_not_configured"));
    const view = await threads.threadView(thread.id);
    assert.equal(view.turns.length, 0);
  });

  it("保存済みの原稿と一致しない選択では対話を始めない", async () => {
    const { threads, anchor } = await setup();
    await assert.rejects(threads.create("a.md", { ...anchor, start: anchor.start + 1, end: anchor.end + 1 }, "interpret"), isCode("stale_selection"));
    await assert.rejects(threads.create("a.md", { ...anchor, sourceDocumentHash: hashContent("別") }, "interpret"), isCode("stale_selection"));
  });

  it("B-03: 反論の返答と本人入力の気づきを別々に保存し、AIへは直近8件だけを送る", async () => {
    const { threads, adapter, anchor, store } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    await threads.assist(thread.id);
    for (let index = 0; index < 5; index += 1) {
      await threads.addAuthorTurn(thread.id, `それは違う。${index}`);
      await threads.assist(thread.id);
    }
    const last = adapter.calls.at(-1);
    assert.equal(last?.action, "reply");
    assert.equal(last?.authorReply, "それは違う。4");
    assert.equal(last?.turns.length, 8);

    await assert.rejects(threads.addInsight(thread.id, "   "), isCode("invalid_request"));
    const withInsight = await threads.addInsight(thread.id, "重要性の低下ではなく、役割の変化が論点だった。");
    assert.equal(withInsight.insights.length, 1);
    assert.equal(withInsight.insights[0]?.text, "重要性の低下ではなく、役割の変化が論点だった。");
    const authorTurns = withInsight.turns.filter((turn) => turn.role === "author");
    assert.equal(authorTurns.length, 5);
    // AIの応答から気づきは作られていない。
    assert.equal(store.snapshot().insights.length, 1);
  });

  it("AIの問いに返答する前に、続けて尋ねることはできない", async () => {
    const { threads, anchor } = await setup();
    const thread = await threads.create("a.md", anchor, "counterpoint");
    await threads.assist(thread.id);
    await assert.rejects(threads.assist(thread.id), isCode("awaiting_author"));
    await assert.rejects(threads.addAuthorTurn(thread.id, ""), isCode("invalid_request"));
  });

  it("B-04: 保留した対話は、ストアを開き直しても保留と履歴が残る", async () => {
    const { threads, anchor, data, workspace, documents } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    await threads.assist(thread.id);
    await threads.decide(thread.id, "held");

    const reopened = createThreadService({ store: await openStore(data, workspace), documents, adapter: null });
    const [restored] = await reopened.list("a.md");
    assert.equal(restored?.status, "held");
    assert.equal(restored?.turns.length, 1);
    await reopened.decide(thread.id, "reopened");
    assert.equal((await reopened.threadView(thread.id)).status, "open");
  });

  it("却下した対話には、再開するまでAIで続けられない", async () => {
    const { threads, anchor } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    await threads.decide(thread.id, "dismissed");
    await assert.rejects(threads.assist(thread.id), isCode("dismissed"));
  });

  it("C-05: 本文が変わった対話は stale と表示し、別の位置へ付け直さない", async () => {
    const { threads, anchor, file, adapter } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    await threads.assist(thread.id);
    await fs.writeFile(file, `追記\n${TEXT}`, "utf8");
    const [view] = await threads.list("a.md");
    assert.equal(view?.status, "stale");
    assert.equal(view?.decision, "open");
    assert.deepEqual(view?.anchor, anchor);
    await assert.rejects(threads.assist(thread.id), isCode("stale_thread"));
    assert.equal(adapter.calls.length, 1);
  });

  it("プロバイダーのエラーは、応答を作らずにそのまま伝える", async () => {
    const { threads, adapter, anchor } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    adapter.failNext(new AiError("quota", "OpenAI APIの利用上限か残高不足です"));
    await assert.rejects(threads.assist(thread.id), (error: unknown) => error instanceof StudioError && error.code === "ai_quota" && error.status === 502);
    assert.equal((await threads.threadView(thread.id)).turns.length, 0);
  });
});

describe("修正案の採否", () => {
  it("C-01: 修正案を破棄しても、原稿のバイト列は変わらない", async () => {
    const { threads, anchor, file } = await setup();
    const before = await fs.readFile(file);
    const thread = await threads.create("a.md", anchor, "interpret");
    const { proposal } = await threads.propose(thread.id);
    assert.equal(proposal.status, "pending");
    const result = await threads.decideProposal(proposal.id, "rejected", anchor.sourceDocumentHash);
    assert.equal(result.proposal.status, "rejected");
    assert.equal(result.document, undefined);
    assert.deepEqual(await fs.readFile(file), before);
  });

  it("C-02: 採用すると選択範囲だけが変わり、開き直しても残る", async () => {
    const { threads, anchor, file, data, workspace } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    const { proposal } = await threads.propose(thread.id);
    const result = await threads.decideProposal(proposal.id, "accepted", anchor.sourceDocumentHash);
    const expected = TEXT.slice(0, anchor.start) + proposal.replacementText + TEXT.slice(anchor.end);
    assert.equal(result.document?.content, expected);
    assert.equal(await fs.readFile(file, "utf8"), expected);
    assert.equal(result.proposal.status, "accepted");
    assert.equal(result.proposal.appliedDocumentHash, hashContent(expected));

    const reopened = await openStore(data, workspace);
    const stored = reopened.snapshot().proposals.find((candidate) => candidate.id === proposal.id);
    assert.equal(stored?.status, "accepted");
    assert.equal(stored?.anchor.quote, QUOTE);
  });

  it("C-03: 提案の後に原稿が変わったら採用を 409 で拒否し、強制適用しない", async () => {
    const { threads, anchor, file } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    const { proposal } = await threads.propose(thread.id);
    const edited = TEXT.replace("では、", "それでは、");
    await fs.writeFile(file, edited, "utf8");
    await assert.rejects(
      threads.decideProposal(proposal.id, "accepted", hashContent(edited)),
      (error: unknown) => error instanceof StudioError && error.code === "stale_proposal" && error.status === 409,
    );
    assert.equal(await fs.readFile(file, "utf8"), edited);
    const [view] = await threads.list("a.md");
    assert.equal(view?.proposals[0]?.status, "stale");
  });

  it("判断済みの修正案は、もう一度判断できない", async () => {
    const { threads, anchor } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    const { proposal } = await threads.propose(thread.id);
    await threads.decideProposal(proposal.id, "rejected", anchor.sourceDocumentHash);
    await assert.rejects(threads.decideProposal(proposal.id, "accepted", anchor.sourceDocumentHash), isCode("already_decided"));
  });

  it("空の置換案は検証で拒否し、保存しない", async () => {
    const { threads, adapter, anchor, store } = await setup();
    const thread = await threads.create("a.md", anchor, "interpret");
    adapter.failNext(new AiError("invalid_response", "AIの修正案が想定した形式ではありませんでした"));
    await assert.rejects(threads.propose(thread.id), isCode("ai_invalid_response"));
    assert.equal(store.snapshot().proposals.length, 0);
  });
});

describe("対話データの保存", () => {
  it("壊れた対話データは空で上書きせず、起動を止める", async () => {
    const { workspace, data } = await makeTempDirs();
    await fs.writeFile(path.join(data, "studio.json"), "{壊れている", "utf8");
    await assert.rejects(openStore(data, workspace), /JSON が壊れています/);
    assert.equal(await fs.readFile(path.join(data, "studio.json"), "utf8"), "{壊れている");
  });

  it("書き込みに失敗したら、メモリ上の状態も進めない", async () => {
    const { workspace, data } = await makeTempDirs();
    const store = await openStore(data, workspace);
    await fs.rm(data, { recursive: true });
    await assert.rejects(
      store.update((draft) => {
        draft.insights.push({ id: "x", threadId: "t", text: "気づき", createdAt: "2026-10-15T00:00:00.000Z" });
      }),
      isCode("store_unwritable"),
    );
    assert.equal(store.snapshot().insights.length, 0);
  });
});
