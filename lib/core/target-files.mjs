import path from "node:path";

const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;

export function resolveTargetPatterns({ cwd, files = [] }) {
  if (files.length === 0) return ["**/*.md", "**/*.markdown"];

  return [...new Set(files)]
    .filter((file) => MARKDOWN_PATTERN.test(file))
    .map((file) => {
      const absolutePath = path.resolve(cwd, file);
      const relativePath = path.relative(cwd, absolutePath);
      if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
        throw new Error(`プロジェクト外の文書は検査できません: ${file}`);
      }
      return relativePath.split(path.sep).join("/");
    })
    .sort();
}

export function isMarkdownPath(filePath) {
  return MARKDOWN_PATTERN.test(filePath);
}
