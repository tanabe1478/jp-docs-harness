import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

// 同じディレクトリの一時ファイルへ書いてから rename する。
// 書き込みの途中で落ちても、元のファイルが壊れた状態で残らない。
export async function writeFileAtomic(target: string, content: string, options: { mode?: number } = {}): Promise<void> {
  const directory = path.dirname(target);
  const temp = path.join(directory, `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await fs.open(temp, "wx", options.mode ?? 0o666);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}
