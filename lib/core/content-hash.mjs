import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function hashContent(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

export async function hashFile(filePath) {
  return hashContent(await readFile(filePath));
}
