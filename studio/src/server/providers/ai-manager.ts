import { createModels, type CredentialStore } from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { AiConfig, AiLoginState, AiMode } from "../../shared/schemas.ts";
import { StudioError } from "../errors.ts";
import { getDeviceId } from "../persistence/device-id.ts";
import { readSettings, writeSettings, type StudioSettings } from "../persistence/settings.ts";
import type { AiAdapter } from "./ai-adapter.ts";
import { resolveAiAdapter } from "./resolve.ts";

const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export type AiManager = {
  current(): AiAdapter | null;
  status(): Promise<AiConfig>;
  models(): string[];
  updateSettings(change: { model?: string | null; mode?: AiMode | null }): Promise<AiConfig>;
  startLogin(): Promise<{ authUrl: string }>;
  logout(): Promise<AiConfig>;
};

// 環境変数を優先し、なければ画面で選んだ設定を使って、使う AI を決め直す。
export async function createAiManager({
  env = process.env,
  dataRoot,
  credentials,
  settingsFile,
}: {
  env?: NodeJS.ProcessEnv;
  dataRoot: string;
  credentials: CredentialStore;
  settingsFile: string;
}): Promise<AiManager> {
  let settings: StudioSettings = await readSettings(settingsFile);
  let resolved = await resolve();
  let login: AiLoginState = { state: "idle" };
  let loginAbort: AbortController | null = null;

  const catalog = createModels();
  catalog.setProvider(openaiProvider());

  function effectiveEnv(): NodeJS.ProcessEnv {
    return {
      ...(settings.model ? { JP_DOCS_STUDIO_MODEL: settings.model } : {}),
      ...(settings.ai ? { JP_DOCS_STUDIO_AI: settings.ai } : {}),
      ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== "")),
    };
  }

  async function resolve() {
    return resolveAiAdapter({ env: effectiveEnv(), credentials });
  }

  async function status(): Promise<AiConfig> {
    const stored = await credentials.read("openai");
    const common = {
      manageable: true,
      loggedIn: stored?.type === "oauth",
      apiKeyAvailable: Boolean(env.OPENAI_API_KEY?.trim()),
      settings: { model: settings.model ?? null, mode: settings.ai ?? null },
      overriddenByEnv: { model: Boolean(env.JP_DOCS_STUDIO_MODEL?.trim()), mode: Boolean(env.JP_DOCS_STUDIO_AI?.trim()) },
      login,
    };
    return resolved.adapter
      ? { configured: true, provider: resolved.adapter.provider, model: resolved.adapter.model, ...common }
      : { configured: false, provider: null, model: null, reason: resolved.reason, ...common };
  }

  return {
    current: () => resolved.adapter,
    status,
    models: () => catalog.getModels("openai").map((model) => model.id),
    async updateSettings(change) {
      const next: StudioSettings = { ...settings };
      if (change.model !== undefined) {
        if (change.model === null) delete next.model;
        else next.model = change.model;
      }
      if (change.mode !== undefined) {
        if (change.mode === null) delete next.ai;
        else next.ai = change.mode;
      }
      await writeSettings(settingsFile, next);
      settings = next;
      resolved = await resolve();
      return status();
    },
    // ブラウザでのログインを始め、認可 URL を返す。完了はブラウザからのコールバックで決まる。
    async startLogin() {
      loginAbort?.abort();
      const abort = new AbortController();
      loginAbort = abort;
      const timer = setTimeout(() => abort.abort(), LOGIN_TIMEOUT_MS);
      const models = createModels({ credentials });
      models.setProvider(openaiProvider());

      let announce: (url: string) => void = () => undefined;
      let fail: (error: unknown) => void = () => undefined;
      const authUrl = new Promise<string>((resolveUrl, rejectUrl) => {
        announce = resolveUrl;
        fail = rejectUrl;
      });

      void models
        .login(
          "openai",
          "oauth",
          {
            signal: abort.signal,
            notify(event) {
              if (event.type === "auth_url") {
                login = { state: "pending", authUrl: event.url };
                announce(event.url);
              }
            },
            // 手入力は使わず、ブラウザからのコールバックだけで完了させる。
            prompt: (request) =>
              new Promise<string>((_resolve, reject) => {
                request.signal?.addEventListener("abort", () => reject(new Error("入力は使いません")), { once: true });
              }),
          },
          { getDeviceId: () => getDeviceId(dataRoot), agentName: "jp-docs Studio" },
        )
        .then(async () => {
          if (loginAbort !== abort) return;
          login = { state: "idle" };
          resolved = await resolve();
        })
        .catch((error: unknown) => {
          if (loginAbort !== abort) return;
          const message = error instanceof Error ? error.message : String(error);
          login = { state: "failed", error: message.includes("EADDRINUSE") ? "ログイン用のポート 1455 が使われています。ほかのログイン（pi や Codex など）を終えてから試してください" : `ログインできませんでした: ${message}` };
          fail(error);
        })
        .finally(() => clearTimeout(timer));

      try {
        return { authUrl: await authUrl };
      } catch {
        throw new StudioError("login_failed", login.state === "failed" ? login.error : "ログインを始められませんでした", 502);
      }
    },
    async logout() {
      loginAbort?.abort();
      loginAbort = null;
      login = { state: "idle" };
      await credentials.delete("openai");
      resolved = await resolve();
      return status();
    },
  };
}

// テストや固定構成用。設定を画面から変えられない。
export function createStaticAiManager(adapter: AiAdapter | null, reason = "AIが設定されていません"): AiManager {
  const status = async (): Promise<AiConfig> => {
    const common = {
      manageable: false,
      loggedIn: false,
      apiKeyAvailable: false,
      settings: { model: null, mode: null },
      overriddenByEnv: { model: false, mode: false },
      login: { state: "idle" } as const,
    };
    return adapter
      ? { configured: true, provider: adapter.provider, model: adapter.model, ...common }
      : { configured: false, provider: null, model: null, reason, ...common };
  };
  const unsupported = async (): Promise<never> => {
    throw new StudioError("not_manageable", "この起動方法では AI の設定を画面から変更できません", 409);
  };
  return { current: () => adapter, status, models: () => [], updateSettings: unsupported, startLogin: unsupported, logout: unsupported };
}
