import { createHash } from "node:crypto";

// ハッシュは UTF-8 のバイト列に対して計算する。オフセット（UTF-16）とは単位が異なる。
export function hashContent(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}`;
}
