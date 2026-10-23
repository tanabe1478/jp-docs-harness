import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  AuthenticationError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
} from "openai";
import { AiError, validateAiOutput, type AiAdapter, type AiInput, type AiOutput } from "./ai-adapter.ts";
import {
  PROPOSAL_JSON_SCHEMA,
  REFLECTION_JSON_SCHEMA,
  STUDIO_INSTRUCTIONS,
  buildModelInput,
} from "./prompt.ts";

export type OpenAiAdapterOptions = {
  apiKey: string;
  model: string;
  timeoutMs?: number;
  client?: OpenAI;
};

export function createOpenAiAdapter({ apiKey, model, timeoutMs = 60_000, client }: OpenAiAdapterOptions): AiAdapter {
  const openai = client ?? new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });

  return {
    provider: "openai",
    model,
    async respond(input: AiInput): Promise<AiOutput> {
      const isProposal = input.action === "propose";
      let response;
      try {
        response = await openai.responses.create({
          model,
          instructions: STUDIO_INSTRUCTIONS,
          input: buildModelInput(input),
          // 原稿を OpenAI 側の会話保存に残さない。
          store: false,
          text: {
            format: {
              type: "json_schema",
              name: isProposal ? "studio_proposal" : "studio_reflection",
              schema: isProposal ? PROPOSAL_JSON_SCHEMA : REFLECTION_JSON_SCHEMA,
              strict: true,
            },
          },
        });
      } catch (error) {
        throw toAiError(error);
      }

      const refusal = response.output
        ?.flatMap((item) => (item.type === "message" ? item.content : []))
        .find((part) => part.type === "refusal");
      if (refusal) throw new AiError("refused", "AIがこの依頼への応答を断りました");

      const text = response.output_text;
      if (!text) throw new AiError("invalid_response", "AIから応答本文が返りませんでした");
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AiError("invalid_response", "AIの応答を読み取れませんでした");
      }
      return validateAiOutput(input.action, parsed);
    },
  };
}

function toAiError(error: unknown): AiError {
  if (error instanceof AiError) return error;
  if (error instanceof APIConnectionTimeoutError) return new AiError("timeout", "AIの応答がタイムアウトしました");
  if (error instanceof APIConnectionError) return new AiError("connection", "AIのサーバーに接続できませんでした");
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AiError("auth", "OpenAI APIキーが無効か、このモデルを使う権限がありません");
  }
  if (error instanceof NotFoundError) {
    return new AiError("model_not_found", "指定したモデルが見つかりません（JP_DOCS_STUDIO_MODEL を確認してください）");
  }
  if (error instanceof RateLimitError) {
    const code = (error.error as { code?: string } | undefined)?.code;
    if (code === "insufficient_quota") {
      return new AiError("quota", "OpenAI APIの利用上限か残高不足です（ChatGPTの有料プランとAPI課金は別です）");
    }
    return new AiError("rate_limit", "OpenAI APIのレート制限に達しました。少し待ってから試してください");
  }
  if (error instanceof APIError) {
    return new AiError("provider", `OpenAI APIがエラーを返しました（HTTP ${error.status ?? "不明"}）`);
  }
  return new AiError("provider", "AIの呼び出しに失敗しました");
}

export function createAdapterFromEnv(env: NodeJS.ProcessEnv = process.env):
  | { adapter: AiAdapter; reason?: undefined }
  | { adapter: null; reason: string } {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.JP_DOCS_STUDIO_MODEL?.trim();
  if (!apiKey && !model) return { adapter: null, reason: "OPENAI_API_KEY と JP_DOCS_STUDIO_MODEL が未設定です" };
  if (!apiKey) return { adapter: null, reason: "OPENAI_API_KEY が未設定です" };
  if (!model) return { adapter: null, reason: "JP_DOCS_STUDIO_MODEL（使用するモデル名）が未設定です" };
  return { adapter: createOpenAiAdapter({ apiKey, model }) };
}
