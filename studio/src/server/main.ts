import { parseArgs } from "node:util";
import { startStudioServer } from "./app.ts";
import { FileCredentialStore, credentialFilePath } from "./persistence/credential-store.ts";
import { defaultDataRoot } from "./persistence/data-dir.ts";
import { resolveAiAdapter } from "./providers/resolve.ts";
import { resolveWorkspaceRoot } from "./security/workspace.ts";

const DEFAULT_PORT = 4873;

async function main() {
  const { values } = parseArgs({
    options: {
      workspace: { type: "string" },
      port: { type: "string" },
      dev: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    process.stdout.write(
      "使い方: npm run dev -- --workspace /absolute/path/to/workspace [--port 4873]\n" +
        "        npm start -- --workspace /absolute/path/to/workspace（npm run build 後）\n",
    );
    return;
  }

  const workspaceRoot = await resolveWorkspaceRoot(values.workspace);
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port が不正です: ${values.port}`);

  const dataRoot = defaultDataRoot();
  const ai = await resolveAiAdapter({ credentials: new FileCredentialStore(credentialFilePath(dataRoot)) });
  const studio = await startStudioServer({
    workspaceRoot,
    dataRoot,
    adapter: ai.adapter,
    ...(ai.reason ? { adapterReason: ai.reason } : {}),
    port,
    client: values.dev ? "dev" : "static",
  });

  process.stdout.write(
    [
      "",
      "  jp-docs Studio",
      `  URL:        ${studio.url}`,
      `  workspace:  ${workspaceRoot}`,
      `  AI:         ${ai.adapter ? `${ai.adapter.provider} / ${ai.adapter.model}` : `未設定（${ai.reason}）`}`,
      "",
    ].join("\n") + "\n",
  );

  const shutdown = () => {
    void studio.close().then(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
    process.stderr.write("jp-docs-studio: ポートが使用中です。--port で別の番号を指定してください\n");
  } else {
    process.stderr.write(`jp-docs-studio: ${message}\n`);
  }
  process.exit(1);
});
