import { Type, type AssistantMessage, type Context, type Model, type Models, type ModelsApiStreamOptions, type Tool } from "@earendil-works/pi-ai";
import { AiError, validateAiOutput, type AiAdapter, type AiInput, type AiOutput } from "./ai-adapter.ts";
import { STUDIO_INSTRUCTIONS, buildModelInput } from "./prompt.ts";

const REFLECTION_TOOL: Tool = {
  name: "studio_reflection",
  description: "読者としての読み、そう読んだ理由、書き手への問いを返す",
  parameters: Type.Object({
    interpretation: Type.String(),
    reasoning: Type.String(),
    question: Type.String(),
    uncertainty: Type.String(),
  }),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
};

const PROPOSAL_TOOL: Tool = {
  name: "studio_proposal",
  description: "選択箇所だけを置き換える文案と、その理由を返す",
  parameters: Type.Object({
    replacementText: Type.String(),
    rationale: Type.String(),
  }),
  constrainedSampling: { type: "json_schema", strict: "prefer" },
};

export type PiAiAdapterOptions = {
  models: Models;
  model: Model<string>;
  provider: string;
  timeoutMs?: number;
};

// pi-ai の Models を通してモデルを呼ぶ。認証（ChatGPT のログインや API キー）と
// トークンの更新は pi-ai と CredentialStore に任せ、このアダプターは扱わない。
export function createPiAiAdapter({ models, model, provider, timeoutMs = 90_000 }: PiAiAdapterOptions): AiAdapter {
  return {
    provider,
    model: model.id,
    async respond(input: AiInput): Promise<AiOutput> {
      const tool = input.action === "propose" ? PROPOSAL_TOOL : REFLECTION_TOOL;
      const context: Context = {
        systemPrompt: `${STUDIO_INSTRUCTIONS}\n\n結果は必ず ${tool.name} ツールの引数として返してください。`,
        messages: [{ role: "user", content: buildModelInput(input), timestamp: Date.now() }],
        tools: [tool],
      };
      let status: number | undefined;
      let message: AssistantMessage;
      try {
        message = await models.complete(model, context, {
          signal: AbortSignal.timeout(timeoutMs),
          // ツールを必ず呼ばせ、自由文での回答にしない。
          toolChoice: "required",
          onResponse: (response) => {
            status = response.status;
          },
        } as ModelsApiStreamOptions<string>);
      } catch (error) {
        throw toAiError(error instanceof Error ? error.message : String(error), status);
      }

      if (message.stopReason === "aborted") throw new AiError("timeout", "AIの応答がタイムアウトしました");
      if (message.stopReason === "error") throw toAiError(message.errorMessage ?? "", status);

      const call = message.content.find((block) => block.type === "toolCall" && block.name === tool.name);
      if (call?.type === "toolCall") return validateAiOutput(input.action, call.arguments);

      // ツールを使わずに JSON を本文で返したモデルにも対応する。それ以外の自由文は受け取らない。
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      const json = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text)?.[1] ?? text;
      try {
        return validateAiOutput(input.action, JSON.parse(json));
      } catch {
        throw new AiError("invalid_response", "AIの応答が想定した形式ではありませんでした");
      }
    },
  };
}

export function toAiError(message: string, status?: number): AiError {
  const text = message.toLowerCase();
  if (status === 401 || status === 403 || /unauthori[sz]ed|invalid.*(token|api key)|oauth|refresh|login/.test(text)) {
    return new AiError("auth", "AIの認証に失敗しました。npm run login で ChatGPT にログインし直すか、APIキーを確認してください");
  }
  if (status === 404 || /model.*(not found|does not exist)|unknown model/.test(text)) {
    return new AiError("model_not_found", "指定したモデルを使えません（JP_DOCS_STUDIO_MODEL を確認してください）");
  }
  if (/insufficient_quota|quota|usage limit|billing/.test(text)) {
    return new AiError("quota", "利用上限に達しています。ChatGPT のプランの上限か、API の残高を確認してください");
  }
  if (status === 429 || /rate.?limit|too many requests/.test(text)) {
    return new AiError("rate_limit", "レート制限に達しました。少し待ってから試してください");
  }
  if (/timeout|timed out|aborted/.test(text)) return new AiError("timeout", "AIの応答がタイムアウトしました");
  if (/fetch failed|econn|enotfound|network|socket/.test(text)) {
    return new AiError("connection", "AIのサーバーに接続できませんでした");
  }
  return new AiError("provider", `AIの呼び出しに失敗しました${status ? `（HTTP ${status}）` : ""}`);
}
