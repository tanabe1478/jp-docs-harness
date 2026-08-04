import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDocumentScope } from "../lib/core/document-scope.mjs";
import { runHarness } from "../lib/run-harness.mjs";
import { resolvePluginContext } from "./plugin-context.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

try {
  const target = parseTarget(process.argv.slice(2));
  const scope = resolveDocumentScope({ projectDir, target });
  const { pluginRoot, nodeModulesDir, requireFromData } = resolvePluginContext({
    packageRoot,
    probe: "textlint",
  });
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
    nodeModulesDir,
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
