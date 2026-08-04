import { execFileSync } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;

export function resolveDocumentScope({ projectDir, target = "" }) {
  const projectRoot = path.resolve(projectDir);
  const requestedTarget = path.resolve(projectRoot, target || ".");
  const relativeToProject = path.relative(projectRoot, requestedTarget);

  if (isOutside(relativeToProject)) {
    throw new Error("プロジェクト外は検査できません");
  }
  if (!existsSync(requestedTarget)) {
    throw new Error(`対象がありません: ${target || "."}`);
  }

  // git rev-parse --show-toplevel はsymlinkを解決した実体パスを返すため、
  // リポジトリルートからの相対パスを求める前に対象側も実体パスへ揃える。
  const absoluteTarget = realpathSync(requestedTarget);
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
