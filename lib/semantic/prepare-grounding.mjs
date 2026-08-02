import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashContent } from "../core/content-hash.mjs";
import { readLockedSnapshot } from "./evidence-lock.mjs";

const MAX_SOURCE_BYTES = 1024 * 1024;

export async function prepareGrounding({ cwd, evidence = {} }) {
  const sources = [];
  for (const source of evidence.sources ?? []) {
    const prepared = { id: source.id };
    if (source.url) prepared.url = source.url;

    if (source.path) {
      const absolutePath = path.resolve(cwd, source.path);
      assertInsideProject(cwd, absolutePath, source.path);
      prepared.path = path.relative(cwd, absolutePath).split(path.sep).join("/");
      if (!existsSync(absolutePath)) {
        prepared.status = "missing";
      } else {
        const content = await readFile(absolutePath, "utf8");
        if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_BYTES) {
          throw new Error(`根拠資料が1 MiBを超えています: ${source.path}`);
        }
        prepared.status = "loaded";
        prepared.contentHash = hashContent(content);
        prepared.content = content;
      }
    } else if (source.url) {
      const snapshot = await readLockedSnapshot({ cwd, url: source.url });
      prepared.status = snapshot.status;
      if (snapshot.entry) prepared.snapshotPath = snapshot.entry.path;
      if (snapshot.status === "loaded") {
        if (Buffer.byteLength(snapshot.content, "utf8") > MAX_SOURCE_BYTES) {
          throw new Error(`根拠資料が1 MiBを超えています: ${source.url}`);
        }
        prepared.contentHash = snapshot.contentHash;
        prepared.content = snapshot.content;
      }
    }
    sources.push(prepared);
  }

  return {
    evidenceHash: hashContent(JSON.stringify(sources)),
    policy: sources.length > 0 ? "cite-or-flag" : "no-declared-sources",
    sources,
  };
}

function assertInsideProject(cwd, absolutePath, originalPath) {
  const relative = path.relative(cwd, absolutePath);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`プロジェクト外の根拠資料は指定できません: ${originalPath}`);
  }
}
