import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { consumeClaudeTouchedFiles } from "../lib/integrations/claude-session-files.mjs";
import { runHarness } from "../lib/run-harness.mjs";

const event = await readEvent();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? event.cwd;

if (!pluginRoot || !pluginData || !projectDir) {
  block("jp-docs-harnessの実行に必要なClaude Codeの環境変数がありません。");
}

try {
  const files = await consumeClaudeTouchedFiles({ pluginData, event });
  if (files.length === 0) process.exit(0);

  const requireFromData = createRequire(path.join(pluginData, "package.json"));
  const textlintPath = requireFromData.resolve("textlint");
  const yamlPath = requireFromData.resolve("yaml");
  const ajvPath = requireFromData.resolve("ajv/dist/2020.js");
  const textlint = await import(pathToFileURL(textlintPath).href);
  const yaml = await import(pathToFileURL(yamlPath).href);
  const { default: Ajv } = await import(pathToFileURL(ajvPath).href);
  const result = await runHarness({
    textlint,
    yaml,
    Ajv,
    cwd: projectDir,
    files,
    configFilePath: path.join(pluginRoot, ".textlintrc.json"),
    nodeModulesDir: path.join(pluginData, "node_modules"),
  });

  if (!result.hasFindings) process.exit(0);
  if (!result.hasErrors) {
    notify(result.humanOutput);
  }
  if (event.stop_hook_active) {
    notify(`自動修正後も確認が必要な指摘が残っています。\n\n${result.humanOutput}`);
  }

  block(`Markdownの検査で修正が必要なエラーが見つかりました。文意を保って修正し、再検査してください。\n\n${result.humanOutput}`);
} catch (error) {
  block(`jp-docs-harnessの実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`);
}

async function readEvent() {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  try {
    return JSON.parse(body);
  } catch {
    block("Claude Codeから受け取った入力を解析できませんでした。");
  }
}

function notify(message) {
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
  process.exit(0);
}

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  process.exit(0);
}
