import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { StudioError } from "../errors.ts";

export const MAX_DOCUMENT_BYTES = 2 * 1024 * 1024;
const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;

export type ResolvedPath = { relative: string; absolute: string };

export async function resolveWorkspaceRoot(input: string | undefined): Promise<string> {
  if (!input) throw new Error("--workspace に執筆用ディレクトリの絶対パスを指定してください");
  if (!path.isAbsolute(input)) {
    throw new Error(`--workspace には絶対パスを指定してください: ${input}`);
  }
  let real: string;
  try {
    real = await fs.realpath(input);
  } catch {
    throw new Error(`workspace が見つかりません: ${input}`);
  }
  const stat = await fs.stat(real);
  if (!stat.isDirectory()) throw new Error(`workspace はディレクトリではありません: ${input}`);
  await fs.access(real, constants.R_OK | constants.W_OK).catch(() => {
    throw new Error(`workspace を読み書きできません: ${input}`);
  });
  return real;
}

// クライアントから受け取る相対パスを検証する。区切りは / と \ の両方を受け付け、
// 返り値は常に / 区切り。隠しディレクトリ（.git など）は対象にしない。
export function normalizeRelativePath(input: string): string[] {
  if (typeof input !== "string" || input.length === 0 || input.length > 1024 || input.includes("\0")) {
    throw new StudioError("invalid_path", "パスが不正です", 400);
  }
  if (path.posix.isAbsolute(input) || path.win32.isAbsolute(input) || /^[a-zA-Z]:/.test(input)) {
    throw new StudioError("outside_workspace", "workspace 外のファイルは扱えません", 403);
  }
  const segments = input.split(/[\\/]/);
  for (const segment of segments) {
    if (segment === "" || segment === "." || segment === "..") {
      throw new StudioError("outside_workspace", "workspace 外のファイルは扱えません", 403);
    }
    if (segment.startsWith(".")) {
      throw new StudioError("invalid_path", "隠しファイルや隠しディレクトリは扱えません", 403);
    }
  }
  return segments;
}

export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function requireExtension(segments: string[], pattern: RegExp, label: string) {
  const name = segments.at(-1) ?? "";
  if (!pattern.test(name)) throw new StudioError("not_markdown", `${label}だけを扱えます`, 400);
}

// 既存ファイルを解決する。symlink は実体へ解決してから workspace 内かを確かめる。
export async function resolveExistingFile(
  root: string,
  input: string,
  { pattern = MARKDOWN_PATTERN, label = "Markdown ファイル", maxBytes = MAX_DOCUMENT_BYTES } = {},
): Promise<ResolvedPath> {
  const segments = normalizeRelativePath(input);
  requireExtension(segments, pattern, label);
  const joined = path.join(root, ...segments);
  let real: string;
  try {
    real = await fs.realpath(joined);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new StudioError("not_found", "ファイルが見つかりません", 404);
    }
    throw new StudioError("unreadable", "ファイルを読み取れません", 500);
  }
  if (!isInside(root, real)) {
    throw new StudioError("outside_workspace", "workspace 外のファイルは扱えません", 403);
  }
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new StudioError("not_found", "ファイルが見つかりません", 404);
  if (stat.size > maxBytes) {
    throw new StudioError("too_large", `ファイルが大きすぎます（上限 ${maxBytes} バイト）`, 413);
  }
  return { relative: segments.join("/"), absolute: real };
}

// 新規作成するパスを解決する。親ディレクトリは既存で workspace 内にある必要がある。
export async function resolveNewFile(root: string, input: string): Promise<ResolvedPath> {
  const segments = normalizeRelativePath(input);
  requireExtension(segments, MARKDOWN_PATTERN, "Markdown ファイル（.md）");
  const parent = path.join(root, ...segments.slice(0, -1));
  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch {
    throw new StudioError("not_found", "保存先のディレクトリがありません", 404);
  }
  if (realParent !== root && !isInside(root, realParent)) {
    throw new StudioError("outside_workspace", "workspace 外のファイルは扱えません", 403);
  }
  return { relative: segments.join("/"), absolute: path.join(realParent, segments.at(-1) ?? "") };
}

export function isMarkdownName(name: string): boolean {
  return MARKDOWN_PATTERN.test(name);
}
