import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runHarness } from "../lib/run-harness.mjs";

const event = await readEvent();
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? event.cwd;

if (!pluginRoot || !pluginData || !projectDir) {
  block("jp-docs-harnessの実行に必要なClaude Codeの環境変数がありません。");
}

try {
  const requireFromData = createRequire(path.join(pluginData, "package.json"));
  const textlintPath = requireFromData.resolve("textlint");
  const textlint = await import(pathToFileURL(textlintPath).href);
  const result = await runHarness({
    textlint,
    cwd: projectDir,
    configFilePath: path.join(pluginRoot, ".textlintrc.json"),
    nodeModulesDir: path.join(pluginData, "node_modules"),
  });

  if (!result.hasFindings || event.stop_hook_active) process.exit(0);

  block(`Markdownにtextlintの指摘があります。文意を保って修正し、再検査してください。\n\n${result.humanOutput}`);
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

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  process.exit(0);
}
