// E2E 用のサーバー。FakeAdapter を注入し、AI呼び出しの回数と内容を観測できるようにする。
// 通常起動とは別のエントリーで、テストからだけ使う。
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { startStudioServer } from "../../src/server/app.ts";
import { resolveWorkspaceRoot } from "../../src/server/security/workspace.ts";
import { createFakeAdapter } from "../fixtures/fake-adapter.ts";

const { values } = parseArgs({
  options: {
    workspace: { type: "string" },
    data: { type: "string" },
    port: { type: "string" },
    "control-port": { type: "string" },
    "no-ai": { type: "boolean", default: false },
  },
});

const adapter = createFakeAdapter();
const workspaceRoot = await resolveWorkspaceRoot(values.workspace);
const studio = await startStudioServer({
  workspaceRoot,
  dataRoot: values.data ?? "",
  adapter: values["no-ai"] ? null : adapter,
  ...(values["no-ai"] ? { adapterReason: "OPENAI_API_KEY と JP_DOCS_STUDIO_MODEL が未設定です" } : {}),
  port: Number(values.port ?? 0),
  client: "static",
});

// テストが FakeAdapter の呼び出し記録を読むための口。Studio とは別のポートで待ち受ける。
const control = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/calls") {
    response.end(JSON.stringify(adapter.calls));
    return;
  }
  if (request.url === "/reset" && request.method === "POST") {
    adapter.calls.length = 0;
    response.end("{}");
    return;
  }
  response.statusCode = 404;
  response.end("{}");
});
control.listen(Number(values["control-port"] ?? 0), "127.0.0.1", () => {
  const address = control.address();
  const controlPort = typeof address === "object" && address ? address.port : 0;
  process.stdout.write(`studio ready ${studio.url} control ${controlPort}\n`);
});
