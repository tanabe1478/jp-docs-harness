import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashContent } from "../core/content-hash.mjs";

export const EVIDENCE_LOCK_PATH = ".jp-docs-harness/evidence.lock.json";

export function evidenceSnapshotKey(url) {
  return createHash("sha256").update(url).digest("hex");
}

export async function loadEvidenceLock(cwd) {
  const lockPath = path.join(cwd, EVIDENCE_LOCK_PATH);
  if (!existsSync(lockPath)) return { schemaVersion: 1, sources: {} };
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock?.schemaVersion !== 1 || !lock.sources || typeof lock.sources !== "object") {
    throw new Error(`${EVIDENCE_LOCK_PATH}が無効です`);
  }
  for (const [key, entry] of Object.entries(lock.sources)) {
    if (
      key !== evidenceSnapshotKey(entry?.url ?? "") ||
      typeof entry?.path !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(entry?.contentHash ?? "") ||
      typeof entry?.fetchedAt !== "string"
    ) {
      throw new Error(`${EVIDENCE_LOCK_PATH}のentryが無効です: ${key}`);
    }
  }
  return lock;
}

export async function writeEvidenceSnapshot({ cwd, url, content, metadata = {} }) {
  const key = evidenceSnapshotKey(url);
  const relativePath = `.jp-docs-harness/evidence/${key}.snapshot.txt`;
  const absolutePath = path.join(cwd, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);

  const lock = await loadEvidenceLock(cwd);
  lock.sources[key] = {
    url,
    path: relativePath,
    contentHash: hashContent(content),
    fetchedAt: metadata.fetchedAt ?? new Date().toISOString(),
    ...(metadata.resolvedUrl && metadata.resolvedUrl !== url
      ? { resolvedUrl: metadata.resolvedUrl }
      : {}),
    ...(metadata.contentType ? { contentType: metadata.contentType } : {}),
    ...(metadata.etag ? { etag: metadata.etag } : {}),
    ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {}),
  };
  await writeLockAtomic(cwd, lock);
  return lock.sources[key];
}

export async function readLockedSnapshot({ cwd, url }) {
  const lock = await loadEvidenceLock(cwd);
  const entry = lock.sources[evidenceSnapshotKey(url)];
  if (!entry || entry.url !== url) return { status: "external" };

  const absolutePath = path.resolve(cwd, entry.path);
  assertInsideProject(cwd, absolutePath, entry.path);
  if (!existsSync(absolutePath)) return { status: "missing-snapshot", entry };
  const content = await readFile(absolutePath, "utf8");
  const contentHash = hashContent(content);
  if (contentHash !== entry.contentHash) {
    return { status: "invalid-snapshot", entry, actualContentHash: contentHash };
  }
  return { status: "loaded", entry, content, contentHash };
}

async function writeLockAtomic(cwd, lock) {
  const destination = path.join(cwd, EVIDENCE_LOCK_PATH);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(lock, null, 2)}\n`);
  await rename(temporary, destination);
}

function assertInsideProject(cwd, absolutePath, originalPath) {
  const relative = path.relative(cwd, absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`プロジェクト外のsnapshotは使用できません: ${originalPath}`);
  }
}
