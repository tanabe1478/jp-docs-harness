import type {
  Anchor,
  CheckResult,
  ContractResult,
  DocumentPayload,
  DocumentSummary,
  ProposalView,
  SentScope,
  StudioConfig,
  ThreadMode,
  ThreadView,
} from "../../shared/schemas.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "x-jp-docs-studio": "1",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "Studio のサーバーに接続できません。サーバーが起動しているか確認してください");
  }
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    throw new ApiError(response.status, "invalid_response", "サーバーの応答を読み取れませんでした");
  }
  if (!response.ok) {
    const error = (data as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "unknown",
      error?.message ?? `サーバーがエラーを返しました（HTTP ${response.status}）`,
      error?.details,
    );
  }
  return data as T;
}

const q = (path: string) => encodeURIComponent(path);

export const api = {
  config: () => request<StudioConfig>("GET", "/api/config"),
  listDocuments: () => request<{ documents: DocumentSummary[] }>("GET", "/api/documents"),
  readDocument: (path: string) => request<DocumentPayload>("GET", `/api/document?path=${q(path)}`),
  createDocument: (path: string, content = "") => request<DocumentPayload>("POST", "/api/documents", { path, content }),
  saveDocument: (path: string, content: string, expectedHash: string) =>
    request<{ path: string; contentHash: string; modifiedAt: string }>("PUT", "/api/document", {
      path,
      content,
      expectedHash,
    }),
  listThreads: (path: string) => request<{ threads: ThreadView[] }>("GET", `/api/threads?path=${q(path)}`),
  createThread: (path: string, anchor: Anchor, mode: ThreadMode) =>
    request<ThreadView>("POST", "/api/threads", { path, anchor, mode }),
  assist: (threadId: string) =>
    request<{ thread: ThreadView; sent: SentScope }>("POST", `/api/threads/${q(threadId)}/assist`, {}),
  addTurn: (threadId: string, text: string) => request<ThreadView>("POST", `/api/threads/${q(threadId)}/turns`, { text }),
  decide: (threadId: string, decision: "held" | "dismissed" | "reopened") =>
    request<ThreadView>("POST", `/api/threads/${q(threadId)}/decision`, { decision }),
  addInsight: (threadId: string, text: string) =>
    request<ThreadView>("POST", `/api/threads/${q(threadId)}/insights`, { text }),
  propose: (threadId: string) =>
    request<{ thread: ThreadView; proposal: ProposalView; sent: SentScope }>(
      "POST",
      `/api/threads/${q(threadId)}/proposals`,
      {},
    ),
  decideProposal: (proposalId: string, decision: "accepted" | "rejected", expectedHash: string) =>
    request<{ proposal: ProposalView; thread: ThreadView; document?: DocumentPayload }>(
      "POST",
      `/api/proposals/${q(proposalId)}/decision`,
      { decision, expectedHash },
    ),
  check: (path: string) => request<CheckResult>("POST", "/api/check", { path }),
  contract: (path: string) => request<ContractResult>("GET", `/api/contract?path=${q(path)}`),
};
