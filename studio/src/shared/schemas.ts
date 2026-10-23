// サーバーとクライアントで共有するデータ型と入力検証。
// クライアントは型だけを `import type` で使い、zod を同梱しない。
import { z } from "zod";

export const MAX_SELECTION_CHARS = 4000;
export const MAX_TURN_CHARS = 4000;
export const MAX_INSIGHT_CHARS = 2000;
export const MAX_REPLACEMENT_CHARS = 8000;

const hashPattern = /^sha256:[0-9a-f]{64}$/;

// start / end は JS 文字列の UTF-16 オフセット。end は含まない。
export const anchorSchema = z
  .object({
    quote: z.string().min(1).max(MAX_SELECTION_CHARS),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    sourceDocumentHash: z.string().regex(hashPattern),
  })
  .refine((anchor) => anchor.end - anchor.start === anchor.quote.length, {
    message: "選択範囲の長さと引用が一致しません",
  });
export type Anchor = z.infer<typeof anchorSchema>;

export const threadModeSchema = z.enum(["interpret", "counterpoint"]);
export type ThreadMode = z.infer<typeof threadModeSchema>;

export const reflectionSchema = z.object({
  interpretation: z.string().min(1).max(4000),
  reasoning: z.string().min(1).max(4000),
  question: z.string().min(1).max(2000),
  uncertainty: z.string().max(2000).optional(),
});
export type Reflection = z.infer<typeof reflectionSchema>;

// AIへ添えた参考資料の記録。内容そのものではなく、名前・ハッシュ・字数だけを残す。
export const sentReferenceSchema = z.object({
  name: z.string(),
  hash: z.string(),
  chars: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type SentReference = z.infer<typeof sentReferenceSchema>;

export const turnSchema = z.object({
  id: z.string(),
  role: z.enum(["author", "ai"]),
  text: z.string(),
  createdAt: z.string(),
  reflection: reflectionSchema.optional(),
  references: z.array(sentReferenceSchema).optional(),
});
export type Turn = z.infer<typeof turnSchema>;

// 保存するのは書き手の判断だけ。stale は原稿のハッシュから毎回導く。
export const threadDecisionSchema = z.enum(["open", "held", "dismissed"]);
export type ThreadDecision = z.infer<typeof threadDecisionSchema>;

export const threadRecordSchema = z.object({
  id: z.string(),
  documentPath: z.string(),
  anchor: anchorSchema,
  mode: threadModeSchema,
  decision: threadDecisionSchema,
  turns: z.array(turnSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ThreadRecord = z.infer<typeof threadRecordSchema>;

export const insightSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  text: z.string().min(1).max(MAX_INSIGHT_CHARS),
  createdAt: z.string(),
});
export type Insight = z.infer<typeof insightSchema>;

export const proposalRecordSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  documentPath: z.string(),
  anchor: anchorSchema,
  replacementText: z.string().min(1).max(MAX_REPLACEMENT_CHARS),
  rationale: z.string(),
  status: z.enum(["pending", "accepted", "rejected"]),
  createdAt: z.string(),
  decidedAt: z.string().optional(),
  appliedDocumentHash: z.string().optional(),
});
export type ProposalRecord = z.infer<typeof proposalRecordSchema>;

export type ThreadStatus = "open" | "held" | "dismissed" | "stale";
export type ProposalStatus = "pending" | "accepted" | "rejected" | "stale";

export type ProposalView = Omit<ProposalRecord, "status"> & { status: ProposalStatus };

export type ThreadView = ThreadRecord & {
  status: ThreadStatus;
  insights: Insight[];
  proposals: ProposalView[];
};

export type DocumentSummary = { path: string; size: number; modifiedAt: string };

export type DocumentPayload = {
  path: string;
  content: string;
  contentHash: string;
  modifiedAt: string;
};

export type AiMode = "chatgpt" | "openai-api";

export type AiLoginState = { state: "idle" } | { state: "pending"; authUrl: string } | { state: "failed"; error: string };

// 画面に出す AI の状態。秘密値は含めない。
export type AiConfig = (
  | { configured: true; provider: string; model: string; reason?: undefined }
  | { configured: false; provider: null; model: null; reason: string }
) & {
  // false のときは設定を画面から変えられない（テスト用の固定構成など）。
  manageable: boolean;
  loggedIn: boolean;
  apiKeyAvailable: boolean;
  settings: { model: string | null; mode: AiMode | null };
  overriddenByEnv: { model: boolean; mode: boolean };
  login: AiLoginState;
};

export type StudioConfig = {
  workspaceName: string;
  ai: AiConfig;
  // ネイティブ版（Tauri）の中で動いているか。
  native: boolean;
  harness: { available: boolean; reason?: string };
  dataLocation: string;
};

// 参考資料。workspace 内のファイルか、ネイティブ版のファイル選択で書き手が選んだ外部ファイル。
export const referenceRecordSchema = z.object({
  id: z.string(),
  documentPath: z.string(),
  kind: z.enum(["workspace", "external"]),
  path: z.string(),
  name: z.string(),
  include: z.boolean(),
  addedAt: z.string(),
});
export type ReferenceRecord = z.infer<typeof referenceRecordSchema>;

export type ReferenceView = ReferenceRecord & {
  available: boolean;
  chars: number | null;
  problem?: string;
};

export type SentScope = {
  provider: string;
  model: string;
  selectionChars: number;
  contextChars: number;
  turns: number;
  references: SentReference[];
};

export type HarnessFinding = {
  id: string;
  gate: string;
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
  location?: { startLine?: number; startColumn?: number };
};

export type CheckResult = {
  path: string;
  documentHash: string;
  ranAt: string;
  exitCode: 0 | 1;
  documents: number;
  findings: HarnessFinding[];
  summary: { findings: number; errors: number; warnings: number; infos: number };
};

export type ContractResult =
  | { status: "missing"; contractPath: string }
  | {
      status: "present";
      contractPath: string;
      source: string;
      summary?: string;
      summaryError?: string;
    };

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

// ---- リクエスト本文 ----

export const createDocumentRequest = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().optional(),
});

export const saveDocumentRequest = z.object({
  path: z.string().min(1).max(1024),
  content: z.string(),
  expectedHash: z.string().regex(hashPattern),
});

export const createThreadRequest = z.object({
  path: z.string().min(1).max(1024),
  anchor: anchorSchema,
  mode: threadModeSchema,
});

export const authorTurnRequest = z.object({
  text: z.string().max(MAX_TURN_CHARS),
});

export const threadDecisionRequest = z.object({
  decision: z.enum(["held", "dismissed", "reopened"]),
});

export const insightRequest = z.object({
  text: z.string().max(MAX_INSIGHT_CHARS),
});

export const proposalDecisionRequest = z.object({
  decision: z.enum(["accepted", "rejected"]),
  expectedHash: z.string().regex(hashPattern),
});

export const addReferenceRequest = z.object({
  path: z.string().min(1).max(1024),
  file: z.string().min(1).max(1024),
});

export const nativeReferencesRequest = z.object({
  path: z.string().min(1).max(1024),
  files: z.array(z.string().min(1).max(4096)).min(1).max(20),
});

export const referenceUpdateRequest = z.object({
  include: z.boolean(),
});

export const aiSettingsRequest = z.object({
  model: z.string().min(1).max(200).nullable().optional(),
  mode: z.enum(["chatgpt", "openai-api"]).nullable().optional(),
});

export const checkRequest = z.object({
  path: z.string().min(1).max(1024),
});
