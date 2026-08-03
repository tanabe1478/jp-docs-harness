import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
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
  const target = parseTarget(process.argv.slice(2));
  const scope = resolveScope(projectDir, target);
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
  process.exit(result.hasErrors ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function parseTarget(args) {
  if (args.length === 0) return "";
  if (args.length === 2 && args[0] === "--target") return args[1];
  throw new Error("check-docsにはGitリポジトリまたはMarkdownを1件だけ指定してください");
}

function resolveScope(projectDir, target) {
  const absoluteTarget = path.resolve(projectDir, target || ".");
  const relativeToProject = path.relative(projectDir, absoluteTarget);
  if (relativeToProject === ".." || relativeToProject.startsWith(`..${path.sep}`)) {
    throw new Error("プロジェクト外は検査できません");
  }
  if (!existsSync(absoluteTarget)) throw new Error(`対象がありません: ${target}`);

  const targetIsDirectory = statSync(absoluteTarget).isDirectory();
  const gitStart = targetIsDirectory ? absoluteTarget : path.dirname(absoluteTarget);
  let repositoryRoot;
  try {
    repositoryRoot = path.resolve(
      execFileSync("git", ["-C", gitStart, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim(),
    );
  } catch {
    throw new Error("Gitリポジトリを特定できません。check-docsに対象リポジトリを指定してください");
  }

  if (targetIsDirectory) return { cwd: repositoryRoot, files: [] };
  if (!/\.(?:md|markdown)$/i.test(absoluteTarget)) {
    throw new Error("MarkdownファイルまたはGitリポジトリを指定してください");
  }
  return {
    cwd: repositoryRoot,
    files: [path.relative(repositoryRoot, absoluteTarget).split(path.sep).join("/")],
  };
}
