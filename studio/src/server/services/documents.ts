import fs from "node:fs/promises";
import path from "node:path";
import type { DocumentPayload, DocumentSummary } from "../../shared/schemas.ts";
import { StudioError } from "../errors.ts";
import { hashContent } from "../hash.ts";
import { writeFileAtomic } from "../persistence/atomic-write.ts";
import {
  MAX_DOCUMENT_BYTES,
  isInside,
  isMarkdownName,
  resolveExistingFile,
  resolveNewFile,
} from "../security/workspace.ts";

const MAX_LIST_ENTRIES = 2000;
const MAX_LIST_DEPTH = 8;
const SKIPPED_DIRECTORIES = new Set(["node_modules"]);

const decoder = new TextDecoder("utf-8", { fatal: true });

export type DocumentService = ReturnType<typeof createDocumentService>;

export function createDocumentService(root: string) {
  const locks = new Map<string, Promise<unknown>>();

  // 同じファイルへの読み取り→照合→書き込みを直列化する。
  async function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    locks.set(key, run);
    try {
      return await run;
    } finally {
      if (locks.get(key) === run) locks.delete(key);
    }
  }

  async function readText(absolute: string): Promise<{ content: string; modifiedAt: string }> {
    let buffer: Buffer;
    try {
      buffer = await fs.readFile(absolute);
    } catch {
      throw new StudioError("unreadable", "ファイルを読み取れません", 500);
    }
    if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
      throw new StudioError("too_large", `ファイルが大きすぎます（上限 ${MAX_DOCUMENT_BYTES} バイト）`, 413);
    }
    let content: string;
    try {
      content = decoder.decode(buffer);
    } catch {
      throw new StudioError("not_utf8", "UTF-8 として読めないファイルは開けません", 415);
    }
    const stat = await fs.stat(absolute);
    return { content, modifiedAt: stat.mtime.toISOString() };
  }

  function checkSize(content: string) {
    if (Buffer.byteLength(content, "utf8") > MAX_DOCUMENT_BYTES) {
      throw new StudioError("too_large", `原稿が大きすぎます（上限 ${MAX_DOCUMENT_BYTES} バイト）`, 413);
    }
  }

  async function read(input: string): Promise<DocumentPayload> {
    const resolved = await resolveExistingFile(root, input);
    const { content, modifiedAt } = await readText(resolved.absolute);
    return { path: resolved.relative, content, contentHash: hashContent(content), modifiedAt };
  }

  async function list(): Promise<DocumentSummary[]> {
    const results: DocumentSummary[] = [];
    async function walk(directory: string, depth: number) {
      if (depth > MAX_LIST_DEPTH || results.length >= MAX_LIST_ENTRIES) return;
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (results.length >= MAX_LIST_ENTRIES) return;
        if (entry.name.startsWith(".")) continue;
        const absolute = path.join(directory, entry.name);
        // symlink は辿らない。workspace 外への経路を一覧に出さないため。
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(absolute, depth + 1);
          continue;
        }
        if (!entry.isFile() || !isMarkdownName(entry.name) || !isInside(root, absolute)) continue;
        const stat = await fs.stat(absolute);
        results.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
    }
    await walk(root, 0);
    return results;
  }

  async function create(input: string, content = ""): Promise<DocumentPayload> {
    checkSize(content);
    const resolved = await resolveNewFile(root, input);
    return withLock(resolved.absolute, async () => {
      try {
        // wx: 既存ファイル（壊れた symlink を含む）があれば失敗させ、上書きしない。
        await fs.writeFile(resolved.absolute, content, { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new StudioError("already_exists", "同じ名前のファイルがすでにあります", 409);
        }
        throw new StudioError("unwritable", "ファイルを作成できません", 500);
      }
      return read(resolved.relative);
    });
  }

  async function save(input: string, content: string, expectedHash: string) {
    checkSize(content);
    const resolved = await resolveExistingFile(root, input);
    return withLock(resolved.absolute, async () => {
      const current = await readText(resolved.absolute);
      const currentHash = hashContent(current.content);
      if (currentHash !== expectedHash) {
        throw new StudioError("conflict", "このファイルは別の場所で変更されています", 409, {
          currentHash,
        });
      }
      await writeOrFail(resolved.absolute, content);
      const stat = await fs.stat(resolved.absolute);
      return { path: resolved.relative, contentHash: hashContent(content), modifiedAt: stat.mtime.toISOString() };
    });
  }

  // 提案の採用で使う。ハッシュと引用の両方が一致したときだけ、その範囲を置き換える。
  async function replaceRange(
    input: string,
    anchor: { start: number; end: number; quote: string; sourceDocumentHash: string },
    replacement: string,
  ): Promise<DocumentPayload> {
    const resolved = await resolveExistingFile(root, input);
    return withLock(resolved.absolute, async () => {
      const current = await readText(resolved.absolute);
      const currentHash = hashContent(current.content);
      if (
        currentHash !== anchor.sourceDocumentHash ||
        current.content.slice(anchor.start, anchor.end) !== anchor.quote
      ) {
        throw new StudioError(
          "stale_proposal",
          "元の文章が変更されています。選択し直してください",
          409,
          { currentHash },
        );
      }
      const next = current.content.slice(0, anchor.start) + replacement + current.content.slice(anchor.end);
      checkSize(next);
      await writeOrFail(resolved.absolute, next);
      const stat = await fs.stat(resolved.absolute);
      return {
        path: resolved.relative,
        content: next,
        contentHash: hashContent(next),
        modifiedAt: stat.mtime.toISOString(),
      };
    });
  }

  async function writeOrFail(absolute: string, content: string) {
    try {
      await writeFileAtomic(absolute, content);
    } catch {
      throw new StudioError("unwritable", "ファイルを保存できませんでした", 500);
    }
  }

  return { read, list, create, save, replaceRange };
}
