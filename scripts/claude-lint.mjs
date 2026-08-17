import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDocumentScope } from "../lib/core/document-scope.mjs";
import { runHarness } from "../lib/run-harness.mjs";
import { resolvePluginContext } from "./plugin-context.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

try {
  const { target, boldPolicy, readingLoad } = parseOptions(process.argv.slice(2));
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
    boldPolicy,
    readingLoad,
    configFilePath: path.join(pluginRoot, ".textlintrc.json"),
    nodeModulesDir,
  });

  process.stdout.write(`${result.humanOutput}\n`);
  process.exit(result.hasBlocking ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function parseOptions(args) {
  let target = "";
  let boldPolicy = "forbid";
  let readingLoad = "off";
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--target" && args[index + 1] !== undefined) {
      target = args[index + 1];
      index += 1;
    } else if (args[index] === "--bold" && ["forbid", "moderate", "allow"].includes(args[index + 1])) {
      boldPolicy = args[index + 1];
      index += 1;
    } else if (args[index] === "--reading-load") {
      readingLoad = "check";
    } else {
      throw new Error("check-docsにはGitリポジトリまたはMarkdownを1件だけ指定してください");
    }
  }
  return { target, boldPolicy, readingLoad };
}
