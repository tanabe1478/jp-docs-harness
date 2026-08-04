import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveDocumentScope } from "../lib/core/document-scope.mjs";
import { runHarness } from "../lib/run-harness.mjs";

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (!pluginRoot || !pluginData) {
  process.stderr.write("jp-docs-harness: Claude Code Pluginの環境変数がありません。\n");
  process.exit(2);
}

try {
  const target = parseTarget(process.argv.slice(2));
  const scope = resolveDocumentScope({ projectDir, target });
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
    cwd: scope.cwd,
    files: scope.files,
    configFilePath: path.join(pluginRoot, ".textlintrc.json"),
    nodeModulesDir: path.join(pluginData, "node_modules"),
  });

  process.stdout.write(`${result.humanOutput}\n`);
  process.exit(result.hasBlocking ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function parseTarget(args) {
  if (args.length === 0) return "";
  if (args.length === 2 && args[0] === "--target") return args[1];
  throw new Error("check-docsにはGitリポジトリまたはMarkdownを1件だけ指定してください");
}
