import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sendError, sendJson } from "./http.ts";
import { workspaceDataDir } from "./persistence/data-dir.ts";
import { openStore } from "./persistence/store.ts";
import type { AiAdapter } from "./providers/ai-adapter.ts";
import { createStaticAiManager, type AiManager } from "./providers/ai-manager.ts";
import { createApiRouter } from "./routes/api.ts";
import { applySecurityHeaders, checkRequest } from "./security/request-guard.ts";
import { createDocumentService } from "./services/documents.ts";
import { DEFAULT_HARNESS_BIN, createHarnessService } from "./services/harness.ts";
import { createReferenceService } from "./services/references.ts";
import { createThreadService } from "./services/threads.ts";

export const STUDIO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOST = "127.0.0.1";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};

export type StudioServerOptions = {
  workspaceRoot: string;
  dataRoot: string;
  // ai を渡せば設定を画面から変えられる。adapter はテストなどの固定構成用。
  ai?: AiManager;
  adapter?: AiAdapter | null;
  adapterReason?: string;
  // ネイティブ版の外側（Tauri）だけが知るトークン。外部ファイルの参考資料の登録に使う。
  nativeToken?: string;
  port?: number;
  client: "dev" | "static" | "none";
  harnessBin?: string;
  harnessTimeoutMs?: number;
};

export type StudioServer = { server: Server; url: string; port: number; close(): Promise<void> };

export async function startStudioServer(options: StudioServerOptions): Promise<StudioServer> {
  const root = options.workspaceRoot;
  const dataDirectory = workspaceDataDir(options.dataRoot, root);
  const store = await openStore(dataDirectory, root);
  const documents = createDocumentService(root);
  const ai = options.ai ?? createStaticAiManager(options.adapter ?? null, options.adapterReason);
  const references = createReferenceService({ root, store, documents });
  const threads = createThreadService({ store, documents, adapter: () => ai.current(), references });
  const harness = createHarnessService({
    root,
    documents,
    bin: options.harnessBin ?? DEFAULT_HARNESS_BIN,
    ...(options.harnessTimeoutMs ? { timeoutMs: options.harnessTimeoutMs } : {}),
  });
  const api = createApiRouter({
    root,
    dataLocation: store.filePath,
    ai,
    documents,
    threads,
    references,
    harness,
    native: Boolean(options.nativeToken),
  });

  const dev = options.client === "dev";
  let port = options.port ?? 0;
  let serveClient: (request: IncomingMessage, response: ServerResponse) => Promise<void> = async (_request, response) => {
    response.statusCode = 404;
    response.end();
  };

  const server = createServer(async (request, response) => {
    try {
      applySecurityHeaders(response, { dev });
      const verdict = checkRequest(request, { port, dev, ...(options.nativeToken ? { nativeToken: options.nativeToken } : {}) });
      if (!verdict.ok) {
        sendJson(response, verdict.status, { error: { code: "forbidden", message: verdict.message } });
        return;
      }
      if (request.url?.startsWith("/api/")) {
        const handled = await api.handle(request, response);
        if (!handled) sendJson(response, 404, { error: { code: "not_found", message: "API が見つかりません" } });
        return;
      }
      await serveClient(request, response);
    } catch (error) {
      if (!response.headersSent) sendError(response, error);
      else response.destroy();
    }
  });

  if (options.client === "dev") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: STUDIO_ROOT,
      configFile: path.join(STUDIO_ROOT, "vite.config.ts"),
      server: { middlewareMode: true, hmr: { server } },
      appType: "spa",
    });
    serveClient = (request, response) =>
      new Promise((resolve) => {
        vite.middlewares(request, response, () => {
          response.statusCode = 404;
          response.end();
          resolve();
        });
        response.on("finish", () => resolve());
      });
    server.on("close", () => void vite.close());
  } else if (options.client === "static") {
    serveClient = createStaticHandler(path.join(STUDIO_ROOT, "dist", "client"));
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : port;

  return {
    server,
    port,
    url: `http://${HOST}:${port}/`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function createStaticHandler(directory: string) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end();
      return;
    }
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const candidate = path.normalize(path.join(directory, pathname));
    const insideDist = candidate === directory || candidate.startsWith(`${directory}${path.sep}`);
    let file = insideDist ? candidate : path.join(directory, "index.html");
    let stat = await fs.stat(file).catch(() => null);
    if (!stat || stat.isDirectory()) {
      file = path.join(directory, "index.html");
      stat = await fs.stat(file).catch(() => null);
    }
    if (!stat) {
      response.statusCode = 503;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("画面のビルドがありません。studio ディレクトリで npm run build を実行してください。\n");
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream");
    response.setHeader("Cache-Control", file.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable");
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    response.end(await fs.readFile(file));
  };
}
