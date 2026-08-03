import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;

export function resolveDocumentScope({ projectDir, target = "" }) {
  const projectRoot = path.resolve(projectDir);
  const absoluteTarget = path.resolve(projectRoot, target || ".");
  const relativeToProject = path.relative(projectRoot, absoluteTarget);

  if (isOutside(relativeToProject)) {
    throw new Error("プロジェクト外は検査できません");
  }
  if (!existsSync(absoluteTarget)) {
    throw new Error(`対象がありません: ${target || "."}`);
  }

  const targetIsDirectory = statSync(absoluteTarget).isDirectory();
  if (!targetIsDirectory && !MARKDOWN_PATTERN.test(absoluteTarget)) {
    throw new Error("MarkdownファイルまたはGitリポジトリを指定してください");
  }

  const gitStart = targetIsDirectory ? absoluteTarget : path.dirname(absoluteTarget);
  const repositoryRoot = findRepositoryRoot(gitStart);

  return {
    cwd: repositoryRoot,
    files: targetIsDirectory
      ? []
      : [path.relative(repositoryRoot, absoluteTarget).split(path.sep).join("/")],
  };
}

function findRepositoryRoot(startPath) {
  try {
    return path.resolve(
      execFileSync("git", ["-C", startPath, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
  } catch {
    throw new Error("Gitリポジトリを特定できません。検査対象を指定してください");
  }
}

function isOutside(relativePath) {
  return (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  );
}
