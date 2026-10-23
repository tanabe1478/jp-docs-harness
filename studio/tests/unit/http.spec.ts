import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { after } from "node:test";
import { startStudioServer } from "../../src/server/app.ts";
import type { AiAdapter } from "../../src/server/providers/ai-adapter.ts";
import { createOpenAiAdapter } from "../../src/server/providers/openai-adapter.ts";
import { createFakeAdapter } from "../fixtures/fake-adapter.ts";
import { makeTempDirs, writeFile } from "../fixtures/temp.ts";

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

// fetch は Host ヘッダーを書き換えられないため、http.request で送る。
function send(port: number, options: { method?: string; path: string; headers?: Record<string, string>; body?: unknown }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path,
        headers: {
          host: `127.0.0.1:${port}`,
          ...(payload ? { "content-type": "application/json" } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function startServer({ withAi = true, adapter }: { withAi?: boolean; adapter?: AiAdapter } = {}) {
  const { base, workspace, data } = await makeTempDirs();
  await writeFile(base, "secret.md", "workspace外の秘密");
  await writeFile(workspace, "a.md", "本文です。\n");
  const studio = await startStudioServer({
    workspaceRoot: workspace,
    dataRoot: data,
    adapter: adapter ?? (withAi ? createFakeAdapter() : null),
    adapterReason: "OPENAI_API_KEY と JP_DOCS_STUDIO_MODEL が未設定です",
    client: "none",
  });
  after(() => studio.close());
  const api = (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    send(studio.port, {
      method,
      path,
      body,
      headers: { "x-jp-docs-studio": "1", origin: `http://127.0.0.1:${studio.port}`, ...extra },
    });
  return { studio, api };
}

describe("HTTP の境界", () => {
  it("127.0.0.1 でだけ待ち受ける", async () => {
    const { studio } = await startServer();
    const address = studio.server.address();
    assert.ok(address && typeof address === "object");
    assert.equal(address.address, "127.0.0.1");
  });

  it("許可していない Host を拒否する（DNS rebinding 対策）", async () => {
    const { studio } = await startServer();
    const reply = await send(studio.port, { path: "/api/config", headers: { host: "evil.example:80", "x-jp-docs-studio": "1" } });
    assert.equal(reply.status, 421);
  });

  it("独自ヘッダーのない API 呼び出しと、別オリジンからの変更を拒否する", async () => {
    const { studio, api } = await startServer();
    assert.equal((await send(studio.port, { path: "/api/config" })).status, 403);
    const crossOrigin = await api("PUT", "/api/document", { path: "a.md", content: "x", expectedHash: `sha256:${"0".repeat(64)}` }, { origin: "http://evil.example" });
    assert.equal(crossOrigin.status, 403);
    const noOrigin = await send(studio.port, {
      method: "POST",
      path: "/api/documents",
      body: { path: "b.md" },
      headers: { "x-jp-docs-studio": "1" },
    });
    assert.equal(noOrigin.status, 403);
  });

  it("CSP などのセキュリティヘッダーを付ける", async () => {
    const { api } = await startServer();
    const reply = await api("GET", "/api/config");
    assert.match(String(reply.headers["content-security-policy"]), /script-src 'self'(;|$)/);
    assert.match(String(reply.headers["content-security-policy"]), /frame-ancestors 'none'/);
    assert.equal(reply.headers["x-content-type-options"], "nosniff");
  });

  it("設定には秘密値を含めない", async () => {
    const adapter = createOpenAiAdapter({ apiKey: "sk-test-should-not-leak", model: "test-model" });
    const { api } = await startServer({ adapter });
    const reply = await api("GET", "/api/config");
    assert.equal(reply.status, 200);
    assert.ok(!reply.body.includes("sk-test-should-not-leak"));
    const config = JSON.parse(reply.body);
    assert.deepEqual(config.ai, { configured: true, provider: "openai", model: "test-model" });
  });

  it("A-03: ../ で workspace 外を読もうとしても、内容を返さない", async () => {
    const { api } = await startServer();
    for (const target of ["../secret.md", "..%2Fsecret.md", "%2E%2E/secret.md"]) {
      const reply = await api("GET", `/api/document?path=${target}`);
      assert.equal(reply.status, 403, target);
      assert.ok(!reply.body.includes("秘密"), target);
    }
  });

  it("A-02: 保存の競合を 409 で返す", async () => {
    const { api } = await startServer();
    const opened = JSON.parse((await api("GET", "/api/document?path=a.md")).body);
    const first = await api("PUT", "/api/document", { path: "a.md", content: "一回目", expectedHash: opened.contentHash });
    assert.equal(first.status, 200);
    const stale = await api("PUT", "/api/document", { path: "a.md", content: "古い版から", expectedHash: opened.contentHash });
    assert.equal(stale.status, 409);
    assert.equal(JSON.parse(stale.body).error.code, "conflict");
  });

  it("A-04: AI未設定のとき、AIへの依頼は 503 と設定の案内を返す", async () => {
    const { api } = await startServer({ withAi: false });
    const config = JSON.parse((await api("GET", "/api/config")).body);
    assert.equal(config.ai.configured, false);
    const opened = JSON.parse((await api("GET", "/api/document?path=a.md")).body);
    const thread = JSON.parse(
      (
        await api("POST", "/api/threads", {
          path: "a.md",
          mode: "interpret",
          anchor: { quote: "本文", start: 0, end: 2, sourceDocumentHash: opened.contentHash },
        })
      ).body,
    );
    const reply = await api("POST", `/api/threads/${thread.id}/assist`, {});
    assert.equal(reply.status, 503);
    assert.match(JSON.parse(reply.body).error.message, /OPENAI_API_KEY/);
  });

  it("クライアントは AI の発言を追加できない", async () => {
    const { api } = await startServer();
    const opened = JSON.parse((await api("GET", "/api/document?path=a.md")).body);
    const thread = JSON.parse(
      (
        await api("POST", "/api/threads", {
          path: "a.md",
          mode: "interpret",
          anchor: { quote: "本文", start: 0, end: 2, sourceDocumentHash: opened.contentHash },
        })
      ).body,
    );
    const reply = await api("POST", `/api/threads/${thread.id}/turns`, { text: "書き手の返答", role: "ai" });
    assert.equal(reply.status, 201);
    const turns = JSON.parse(reply.body).turns;
    assert.equal(turns.at(-1).role, "author");
  });

  it("不正な入力を 400 で拒否する", async () => {
    const { api } = await startServer();
    const reply = await api("POST", "/api/threads", { path: "a.md", mode: "rewrite", anchor: {} });
    assert.equal(reply.status, 400);
  });
});
