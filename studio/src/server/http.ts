import type { IncomingMessage, ServerResponse } from "node:http";
import type { z } from "zod";
import { StudioError } from "./errors.ts";

const MAX_BODY_BYTES = 3 * 1024 * 1024;

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(payload);
}

export function sendError(response: ServerResponse, error: unknown) {
  if (error instanceof StudioError) {
    sendJson(response, error.status, {
      error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
    });
    return;
  }
  // 想定外の例外は内容をクライアントへ返さず、サーバー側だけに残す。
  console.error("[studio] 予期しないエラー", error);
  sendJson(response, 500, { error: { code: "internal", message: "サーバーで予期しないエラーが起きました" } });
}

export async function readJsonBody<T extends z.ZodType>(request: IncomingMessage, schema: T): Promise<z.infer<T>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.byteLength;
    if (size > MAX_BODY_BYTES) throw new StudioError("too_large", "リクエストが大きすぎます", 413);
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StudioError("invalid_request", "JSON を読み取れません", 400);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StudioError("invalid_request", "リクエストの形式が正しくありません", 400, result.error.issues);
  }
  return result.data;
}

export type RouteContext = {
  request: IncomingMessage;
  response: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
};

type Route = { method: string; pattern: RegExp; keys: string[]; handler: (context: RouteContext) => Promise<void> };

export function createRouter() {
  const routes: Route[] = [];

  function add(method: string, template: string, handler: Route["handler"]) {
    const keys: string[] = [];
    const pattern = new RegExp(
      `^${template.replace(/:([a-zA-Z]+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      })}$`,
    );
    routes.push({ method, pattern, keys, handler });
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<boolean> {
    const url = new URL(request.url ?? "/", "http://localhost");
    let pathMatched = false;
    for (const route of routes) {
      const match = route.pattern.exec(url.pathname);
      if (!match) continue;
      pathMatched = true;
      if (route.method !== request.method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(match[index + 1] ?? "");
      });
      try {
        await route.handler({ request, response, params, query: url.searchParams });
      } catch (error) {
        sendError(response, error);
      }
      return true;
    }
    if (pathMatched) {
      sendJson(response, 405, { error: { code: "method_not_allowed", message: "許可されていないメソッドです" } });
      return true;
    }
    return false;
  }

  return { add, handle };
}

export function requireQuery(query: URLSearchParams, key: string): string {
  const value = query.get(key);
  if (!value) throw new StudioError("invalid_request", `${key} を指定してください`, 400);
  return value;
}
