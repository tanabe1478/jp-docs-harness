import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;

export async function recordClaudeTouchedFile({ pluginData, event }) {
  const relativePath = relativeMarkdownPath(event.cwd, event.tool_input?.file_path);
  if (!relativePath) return null;

  const statePath = claudeSessionStatePath({ pluginData, event });
  await mkdir(path.dirname(statePath), { recursive: true });
  await appendFile(statePath, `${JSON.stringify(relativePath)}\n`, "utf8");
  return relativePath;
}

export async function consumeClaudeTouchedFiles({ pluginData, event }) {
  const statePath = claudeSessionStatePath({ pluginData, event });
  let source;
  try {
    source = await readFile(statePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  await rm(statePath, { force: true });
  const files = source
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return typeof value === "string" ? [value] : [];
      } catch {
        return [];
      }
    });
  return [...new Set(files)].sort();
}

export async function resetClaudeTouchedFiles({ pluginData, event }) {
  await rm(claudeSessionStatePath({ pluginData, event }), { force: true });
}

function claudeSessionStatePath({ pluginData, event }) {
  if (!pluginData) throw new Error("CLAUDE_PLUGIN_DATAがありません");
  if (!event?.session_id || !event?.cwd) throw new Error("Claude Codeのsession_idまたはcwdがありません");
  const key = createHash("sha256")
    .update(`${event.session_id}\0${path.resolve(event.cwd)}`)
    .digest("hex");
  return path.join(pluginData, "sessions", `${key}.jsonl`);
}

function relativeMarkdownPath(cwd, filePath) {
  if (typeof cwd !== "string" || typeof filePath !== "string" || !MARKDOWN_PATTERN.test(filePath)) {
    return null;
  }
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(path.resolve(cwd), absolutePath);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(path.sep).join("/");
}
