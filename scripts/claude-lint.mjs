import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runHarness } from "../lib/run-harness.mjs";

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (!pluginRoot || !pluginData) {
  process.stderr.write("jp-docs-harness: Claude Code Pluginの環境変数がありません。\n");
  process.exit(2);
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

  if (result.humanOutput) process.stdout.write(`${result.humanOutput}\n`);
  process.exit(result.hasFindings ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
