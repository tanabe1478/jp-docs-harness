import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { after, describe, it } from "node:test";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { startStudioServer } from "../../src/server/app.ts";
import { StudioError } from "../../src/server/errors.ts";
import { hashContent } from "../../src/server/hash.ts";
import { openStore } from "../../src/server/persistence/store.ts";
import { createAiManager } from "../../src/server/providers/ai-manager.ts";
import { createDocumentService } from "../../src/server/services/documents.ts";
import {
  MAX_REFERENCE_CHARS,
  MAX_REFERENCES_TOTAL_CHARS,
  createReferenceService,
} from "../../src/server/services/references.ts";
import { createThreadService } from "../../src/server/services/threads.ts";
import { createFakeAdapter } from "../fixtures/fake-adapter.ts";
import { makeTempDirs, writeFile } from "../fixtures/temp.ts";

const TEXT = "# 題\n\n選ぶ文。\n";

async function setup() {
  const dirs = await makeTempDirs();
  await writeFile(dirs.workspace, "a.md", TEXT);
  const store = await openStore(dirs.data, dirs.workspace);
  const documents = createDocumentService(dirs.workspace);
  const references = createReferenceService({ root: dirs.workspace, store, documents });
  const adapter = createFakeAdapter();
  const threads = createThreadService({ store, documents, adapter, references });
  return { ...dirs, store, documents, references, adapter, threads };
}

const isCode = (code: string) => (error: unknown) => error instanceof StudioError && error.code === code;

describe("参考資料", () => {
  it("workspace 内の Markdown とテキストを添え、AIへ送った資料の名前とハッシュを記録する", async () => {
    const { workspace, references, threads, adapter } = await setup();
    await writeFile(workspace, "notes/背景.txt", "背景の説明です。");
    await writeFile(workspace, "notes/off.md", "添えない資料。");
    await references.addWorkspaceFile("a.md", "notes/背景.txt");
    const [, off] = await references.addWorkspaceFile("a.md", "notes/off.md");
    assert.ok(off);
    await references.update(off.id, false);

    const start = TEXT.indexOf("選ぶ文。");
    const thread = await threads.create("a.md", { quote: "選ぶ文。", start, end: start + 4, sourceDocumentHash: hashContent(TEXT) }, "interpret");
    const { thread: answered, sent } = await threads.assist(thread.id);

    assert.deepEqual(adapter.calls[0]?.references, [{ name: "notes/背景.txt", content: "背景の説明です。" }]);
    assert.deepEqual(sent.references, [{ name: "notes/背景.txt", hash: hashContent("背景の説明です。"), chars: 8, truncated: false }]);
    assert.deepEqual(answered.turns.at(-1)?.references, sent.references);
  });

  it("参考資料を添えなければ、AIへの入力に references を含めない", async () => {
    const { threads, adapter } = await setup();
    const start = TEXT.indexOf("選ぶ文。");
    const thread = await threads.create("a.md", { quote: "選ぶ文。", start, end: start + 4, sourceDocumentHash: hashContent(TEXT) }, "interpret");
    await threads.assist(thread.id);
    assert.equal(adapter.calls[0]?.references, undefined);
  });

  it("1件と合計の字数の上限で切り詰め、切り詰めたことを記録する", async () => {
    const { workspace, references } = await setup();
    for (let index = 0; index < 4; index += 1) await writeFile(workspace, `r${index}.md`, "字".repeat(MAX_REFERENCE_CHARS + 100));
    for (let index = 0; index < 4; index += 1) await references.addWorkspaceFile("a.md", `r${index}.md`);
    const { references: attached, sent } = await references.collectForAi("a.md");
    const total = sent.reduce((sum, item) => sum + item.chars, 0);
    assert.equal(total, MAX_REFERENCES_TOTAL_CHARS);
    assert.equal(attached.length, 3);
    assert.ok(sent.every((item) => item.truncated));
    assert.ok(attached[0]?.content.endsWith("（以下省略）"));
  });

  it("workspace の外・Markdown とテキスト以外・隠しファイルは workspace の資料として登録できない", async () => {
    const { base, workspace, references } = await setup();
    await writeFile(base, "secret.md", "秘密");
    await writeFile(workspace, "image.png", "x");
    await fs.symlink(path.join(base, "secret.md"), path.join(workspace, "link.md"));
    await assert.rejects(references.addWorkspaceFile("a.md", "../secret.md"), isCode("outside_workspace"));
    await assert.rejects(references.addWorkspaceFile("a.md", "link.md"), isCode("outside_workspace"));
    await assert.rejects(references.addWorkspaceFile("a.md", "image.png"), isCode("not_markdown"));
    await assert.rejects(references.addWorkspaceFile("a.md", ".env.md"), isCode("invalid_path"));
  });

  it("外部ファイルは絶対パスの Markdown かテキストだけを登録し、読めなくなったら送らずに示す", async () => {
    const { base, references } = await setup();
    const external = await writeFile(base, "外部/資料.md", "外部の資料。");
    const [view] = await references.addExternalFiles("a.md", [external]);
    assert.equal(view?.kind, "external");
    assert.equal(view?.name, "資料.md");
    assert.equal(view?.available, true);
    await assert.rejects(references.addExternalFiles("a.md", ["relative.md"]), isCode("invalid_path"));
    await assert.rejects(references.addExternalFiles("a.md", [path.join(base, "x.pdf")]), isCode("not_markdown"));

    await fs.rm(external);
    const [missing] = await references.list("a.md");
    assert.equal(missing?.available, false);
    assert.deepEqual((await references.collectForAi("a.md")).sent, []);
  });

  it("同じファイルは二重に登録しない", async () => {
    const { workspace, references } = await setup();
    await writeFile(workspace, "r.md", "資料");
    await references.addWorkspaceFile("a.md", "r.md");
    assert.equal((await references.addWorkspaceFile("a.md", "r.md")).length, 1);
  });
});

function send(port: number, options: { method: string; path: string; headers: Record<string, string>; body?: unknown }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
    const request = http.request(
      { host: "127.0.0.1", port, method: options.method, path: options.path, headers: { host: `127.0.0.1:${port}`, ...(payload ? { "content-type": "application/json" } : {}), ...options.headers } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

describe("ネイティブ版だけが使う参考資料の登録", () => {
  async function start(nativeToken?: string) {
    const { base, workspace, data } = await makeTempDirs();
    await writeFile(workspace, "a.md", TEXT);
    const external = await writeFile(base, "外部.md", "外部の資料");
    const studio = await startStudioServer({ workspaceRoot: workspace, dataRoot: data, adapter: null, client: "none", ...(nativeToken ? { nativeToken } : {}) });
    after(() => studio.close());
    return { studio, external };
  }

  it("正しいトークンがあれば外部ファイルを登録できる", async () => {
    const { studio, external } = await start("token-1234567890");
    const reply = await send(studio.port, { method: "POST", path: "/api/native/references", headers: { "x-jp-docs-native-token": "token-1234567890" }, body: { path: "a.md", files: [external] } });
    assert.equal(reply.status, 201);
    assert.equal(JSON.parse(reply.body).references[0].kind, "external");
  });

  it("画面の通常のヘッダーやトークン違い、トークン未設定の起動では登録できない", async () => {
    const { studio, external } = await start("token-1234567890");
    const body = { path: "a.md", files: [external] };
    const browserLike = await send(studio.port, {
      method: "POST",
      path: "/api/native/references",
      headers: { "x-jp-docs-studio": "1", origin: `http://127.0.0.1:${studio.port}` },
      body,
    });
    assert.equal(browserLike.status, 403);
    const wrong = await send(studio.port, { method: "POST", path: "/api/native/references", headers: { "x-jp-docs-native-token": "token-123456789X" }, body });
    assert.equal(wrong.status, 403);

    const plain = await start();
    const none = await send(plain.studio.port, { method: "POST", path: "/api/native/references", headers: { "x-jp-docs-native-token": "" }, body });
    assert.equal(none.status, 403);
  });
});

describe("画面からの AI の設定", () => {
  const oauth = { type: "oauth" as const, access: "a", refresh: "r", expires: Date.now() + 3_600_000 };

  it("選んだモデルを設定ファイルに保存し、起動し直さずに反映する", async () => {
    const { data } = await makeTempDirs();
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", async () => oauth);
    const settingsFile = path.join(data, "settings.json");
    const manager = await createAiManager({ env: {}, dataRoot: data, credentials, settingsFile });
    assert.equal((await manager.status()).configured, false);
    assert.ok(manager.models().includes("gpt-6-sol"));

    const status = await manager.updateSettings({ model: "gpt-6-sol" });
    assert.equal(status.configured, true);
    assert.equal(manager.current()?.model, "gpt-6-sol");
    assert.deepEqual(JSON.parse(await fs.readFile(settingsFile, "utf8")), { schemaVersion: 1, model: "gpt-6-sol" });

    const reopened = await createAiManager({ env: {}, dataRoot: data, credentials, settingsFile });
    assert.equal(reopened.current()?.model, "gpt-6-sol");
  });

  it("環境変数が設定ファイルより優先され、そのことを状態に示す", async () => {
    const { data } = await makeTempDirs();
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", async () => oauth);
    const manager = await createAiManager({ env: { JP_DOCS_STUDIO_MODEL: "o3" }, dataRoot: data, credentials, settingsFile: path.join(data, "settings.json") });
    await manager.updateSettings({ model: "gpt-6-sol" });
    const status = await manager.status();
    assert.equal(status.model, "o3");
    assert.equal(status.overriddenByEnv.model, true);
    assert.equal(status.settings.model, "gpt-6-sol");
  });

  it("ログアウトするとログイン情報を消し、AIを未設定に戻す", async () => {
    const { data } = await makeTempDirs();
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", async () => oauth);
    const manager = await createAiManager({ env: { JP_DOCS_STUDIO_MODEL: "gpt-6-sol" }, dataRoot: data, credentials, settingsFile: path.join(data, "settings.json") });
    assert.equal((await manager.status()).loggedIn, true);
    const status = await manager.logout();
    assert.equal(status.loggedIn, false);
    assert.equal(status.configured, false);
    assert.equal(await credentials.read("openai"), undefined);
  });

  it("状態には秘密値を含めない", async () => {
    const { data } = await makeTempDirs();
    const credentials = new InMemoryCredentialStore();
    await credentials.modify("openai", async () => ({ ...oauth, access: "secret-access-token", refresh: "secret-refresh-token" }));
    const manager = await createAiManager({ env: { JP_DOCS_STUDIO_MODEL: "gpt-6-sol", OPENAI_API_KEY: "sk-secret" }, dataRoot: data, credentials, settingsFile: path.join(data, "settings.json") });
    const serialized = JSON.stringify(await manager.status());
    assert.ok(!serialized.includes("secret-access-token"));
    assert.ok(!serialized.includes("secret-refresh-token"));
    assert.ok(!serialized.includes("sk-secret"));
  });
});
