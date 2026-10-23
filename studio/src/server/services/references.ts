import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { ReferenceRecord, ReferenceView, SentReference } from "../../shared/schemas.ts";
import { StudioError } from "../errors.ts";
import { hashContent } from "../hash.ts";
import type { Store } from "../persistence/store.ts";
import { MAX_DOCUMENT_BYTES, resolveExistingFile } from "../security/workspace.ts";
import type { DocumentService } from "./documents.ts";

export const REFERENCE_PATTERN = /\.(?:md|markdown|txt)$/i;
export const MAX_REFERENCE_CHARS = 8000;
export const MAX_REFERENCES_TOTAL_CHARS = 24000;
export const MAX_REFERENCES_PER_DOCUMENT = 20;

const decoder = new TextDecoder("utf-8", { fatal: true });

export type ReferenceService = ReturnType<typeof createReferenceService>;

export function createReferenceService({
  root,
  store,
  documents,
  now = () => new Date().toISOString(),
}: {
  root: string;
  store: Store;
  documents: DocumentService;
  now?: () => string;
}) {
  // 参考資料の実体を読む。workspace 内のものは毎回パスの境界を確かめ直す。
  async function readReference(reference: ReferenceRecord): Promise<string> {
    let absolute: string;
    if (reference.kind === "workspace") {
      absolute = (await resolveExistingFile(root, reference.path, { pattern: REFERENCE_PATTERN, label: "Markdown かテキストのファイル" })).absolute;
    } else {
      absolute = await resolveExternalFile(reference.path);
    }
    const buffer = await fs.readFile(absolute).catch(() => {
      throw new StudioError("unreadable", "参考資料を読み取れません", 404);
    });
    try {
      return decoder.decode(buffer);
    } catch {
      throw new StudioError("not_utf8", "UTF-8 として読めない参考資料です", 415);
    }
  }

  async function view(reference: ReferenceRecord): Promise<ReferenceView> {
    try {
      const content = await readReference(reference);
      return { ...reference, available: true, chars: content.length };
    } catch (error) {
      return {
        ...reference,
        available: false,
        chars: null,
        problem: error instanceof StudioError ? error.message : "参考資料を読み取れません",
      };
    }
  }

  async function list(documentPath: string): Promise<ReferenceView[]> {
    const document = await documents.read(documentPath);
    const references = store.snapshot().references.filter((reference) => reference.documentPath === document.path);
    return Promise.all(references.map(view));
  }

  async function add(documentPath: string, entries: Array<{ kind: ReferenceRecord["kind"]; path: string; name: string }>) {
    const document = await documents.read(documentPath);
    await store.update((draft) => {
      const current = draft.references.filter((reference) => reference.documentPath === document.path);
      for (const entry of entries) {
        if (current.some((reference) => reference.kind === entry.kind && reference.path === entry.path)) continue;
        if (current.length >= MAX_REFERENCES_PER_DOCUMENT) {
          throw new StudioError("too_many_references", `参考資料は1つの原稿につき${MAX_REFERENCES_PER_DOCUMENT}件までです`, 400);
        }
        const record: ReferenceRecord = {
          id: randomUUID(),
          documentPath: document.path,
          kind: entry.kind,
          path: entry.path,
          name: entry.name,
          include: true,
          addedAt: now(),
        };
        draft.references.push(record);
        current.push(record);
      }
    });
    return list(document.path);
  }

  // workspace 内のファイルを参考資料にする。
  async function addWorkspaceFile(documentPath: string, file: string): Promise<ReferenceView[]> {
    const resolved = await resolveExistingFile(root, file, { pattern: REFERENCE_PATTERN, label: "Markdown かテキストのファイル" });
    return add(documentPath, [{ kind: "workspace", path: resolved.relative, name: resolved.relative }]);
  }

  // ネイティブ版のファイル選択ダイアログで書き手が選んだ外部ファイルを参考資料にする。
  // この経路はネイティブ側だけが持つトークンで守り、画面からは呼べない。
  async function addExternalFiles(documentPath: string, files: string[]): Promise<ReferenceView[]> {
    const entries = [];
    for (const file of files) {
      const absolute = await resolveExternalFile(file);
      entries.push({ kind: "external" as const, path: absolute, name: path.basename(absolute) });
    }
    return add(documentPath, entries);
  }

  async function update(id: string, include: boolean): Promise<ReferenceView> {
    const record = await store.update((draft) => {
      const target = draft.references.find((reference) => reference.id === id);
      if (!target) throw new StudioError("not_found", "参考資料が見つかりません", 404);
      target.include = include;
      return { ...target };
    });
    return view(record);
  }

  async function remove(id: string): Promise<void> {
    await store.update((draft) => {
      const index = draft.references.findIndex((reference) => reference.id === id);
      if (index < 0) throw new StudioError("not_found", "参考資料が見つかりません", 404);
      draft.references.splice(index, 1);
    });
  }

  // AIへ添える資料を集める。読めない資料は送らず、上限を超える分は切り詰める。
  async function collectForAi(documentPath: string): Promise<{
    references: Array<{ name: string; content: string }>;
    sent: SentReference[];
  }> {
    const included = store.snapshot().references.filter((reference) => reference.documentPath === documentPath && reference.include);
    const references: Array<{ name: string; content: string }> = [];
    const sent: SentReference[] = [];
    let remaining = MAX_REFERENCES_TOTAL_CHARS;
    for (const reference of included) {
      if (remaining <= 0) break;
      let content: string;
      try {
        content = await readReference(reference);
      } catch {
        continue;
      }
      const limit = Math.min(MAX_REFERENCE_CHARS, remaining);
      const truncated = content.length > limit;
      const body = truncated ? content.slice(0, limit) : content;
      remaining -= body.length;
      references.push({ name: reference.name, content: truncated ? `${body}\n（以下省略）` : body });
      sent.push({ name: reference.name, hash: hashContent(content), chars: body.length, truncated });
    }
    return { references, sent };
  }

  return { list, addWorkspaceFile, addExternalFiles, update, remove, collectForAi };
}

export async function resolveExternalFile(input: string): Promise<string> {
  if (!path.isAbsolute(input)) throw new StudioError("invalid_path", "外部の参考資料は絶対パスで指定してください", 400);
  if (!REFERENCE_PATTERN.test(input)) {
    throw new StudioError("not_markdown", "参考資料にできるのは Markdown かテキストのファイルだけです", 400);
  }
  let real: string;
  try {
    real = await fs.realpath(input);
  } catch {
    throw new StudioError("not_found", "参考資料が見つかりません", 404);
  }
  const stat = await fs.stat(real);
  if (!stat.isFile()) throw new StudioError("not_found", "参考資料が見つかりません", 404);
  if (stat.size > MAX_DOCUMENT_BYTES) throw new StudioError("too_large", "参考資料が大きすぎます", 413);
  return real;
}
