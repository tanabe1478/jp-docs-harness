import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const API_HEADER = "x-jp-docs-studio";
export const NATIVE_TOKEN_HEADER = "x-jp-docs-native-token";

export type GuardOptions = { port: number; dev: boolean; nativeToken?: string };

export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

// DNS rebinding 対策として Host を、CSRF 対策として Origin と独自ヘッダーを確かめる。
// 独自ヘッダー付きのリクエストは別オリジンからだと preflight が必要になり、
// このサーバーは CORS を許可しないため、ブラウザが送信しない。
export function checkRequest(request: IncomingMessage, { port, nativeToken }: GuardOptions): { ok: true } | { ok: false; status: number; message: string } {
  const host = request.headers.host ?? "";
  const hosts = allowedHosts(port);
  if (!hosts.has(host)) return { ok: false, status: 421, message: "許可されていないホストです" };

  const url = request.url ?? "/";
  if (!url.startsWith("/api/")) return { ok: true };

  // ネイティブ版の外側（Tauri）からの呼び出し。画面の JavaScript はこのトークンを知らない。
  if (url.startsWith("/api/native/")) {
    const presented = request.headers[NATIVE_TOKEN_HEADER];
    if (!nativeToken || typeof presented !== "string" || !sameSecret(presented, nativeToken)) {
      return { ok: false, status: 403, message: "ネイティブ版の外側からだけ呼べる API です" };
    }
    if (!(request.headers["content-type"] ?? "").startsWith("application/json")) {
      return { ok: false, status: 415, message: "JSON で送信してください" };
    }
    return { ok: true };
  }

  if (request.headers[API_HEADER] !== "1") {
    return { ok: false, status: 403, message: "Studio の画面以外からの API 呼び出しは受け付けません" };
  }
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.origin;
    if (!origin || !hosts.has(origin.replace(/^http:\/\//, "")) || !origin.startsWith("http://")) {
      return { ok: false, status: 403, message: "許可されていないオリジンです" };
    }
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.startsWith("application/json")) {
      return { ok: false, status: 415, message: "JSON で送信してください" };
    }
  }
  return { ok: true };
}

function sameSecret(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function applySecurityHeaders(response: ServerResponse, { dev }: { dev: boolean }) {
  // 開発時は Vite の HMR がインラインスクリプトと WebSocket を使うため緩める。
  const scriptSrc = dev ? "'self' 'unsafe-inline'" : "'self'";
  const connectSrc = dev ? "'self' ws://127.0.0.1:* ws://localhost:*" : "'self'";
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      // CodeMirror がエディタ用の style 要素を挿入するため、style はインラインを許可する。
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      `connect-src ${connectSrc}`,
      "media-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join("; "),
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}
