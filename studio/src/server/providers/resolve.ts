import { createModels, type CredentialStore } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { AiAdapter } from "./ai-adapter.ts";
import { createAdapterFromEnv } from "./openai-adapter.ts";
import { createPiAiAdapter } from "./pi-ai-adapter.ts";

export const CHATGPT_PROVIDER = "openai-chatgpt";
const PI_AI_PROVIDER_ID = "openai";
const MODES = ["chatgpt", "openai-api"] as const;

export type AdapterResolution = { adapter: AiAdapter; reason?: undefined } | { adapter: null; reason: string };

// 使う AI を決める。JP_DOCS_STUDIO_AI で明示しなければ、ChatGPT にログイン済みならそれを、
// そうでなければ OPENAI_API_KEY による OpenAI API を使う。
export async function resolveAiAdapter({
  env = process.env,
  credentials,
}: {
  env?: NodeJS.ProcessEnv;
  credentials: CredentialStore;
}): Promise<AdapterResolution> {
  const mode = env.JP_DOCS_STUDIO_AI?.trim() || undefined;
  if (mode !== undefined && !(MODES as readonly string[]).includes(mode)) {
    return { adapter: null, reason: `JP_DOCS_STUDIO_AI には chatgpt か openai-api を指定してください（指定値: ${mode}）` };
  }

  const stored = await credentials.read(PI_AI_PROVIDER_ID);
  const loggedIn = stored?.type === "oauth";
  if (mode === "chatgpt" || (mode === undefined && loggedIn)) {
    if (!loggedIn) {
      return { adapter: null, reason: "ChatGPT にログインしていません。studio ディレクトリで npm run login を実行してください" };
    }
    const modelId = env.JP_DOCS_STUDIO_MODEL?.trim();
    if (!modelId) return { adapter: null, reason: "JP_DOCS_STUDIO_MODEL（使用するモデル名）が未設定です" };
    const models = createModels({ credentials });
    models.setProvider(openaiProvider());
    const model = models.getModel(PI_AI_PROVIDER_ID, modelId);
    if (!model) {
      return { adapter: null, reason: `モデル ${modelId} は pi-ai の OpenAI のモデル一覧にありません（JP_DOCS_STUDIO_MODEL を確認してください）` };
    }
    return { adapter: createPiAiAdapter({ models, model, provider: CHATGPT_PROVIDER }) };
  }

  const fromEnv = createAdapterFromEnv(env);
  if (fromEnv.adapter || mode === "openai-api") return fromEnv;
  return {
    adapter: null,
    reason: "AIが設定されていません。npm run login で ChatGPT にログインするか、OPENAI_API_KEY を設定し、JP_DOCS_STUDIO_MODEL にモデル名を指定してください",
  };
}
