import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

// テストごとに workspace とデータ置き場を作り、終了時に消す。
export async function makeTempDirs() {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "jp-docs-studio-test-")));
  const workspace = path.join(base, "workspace");
  const data = path.join(base, "data");
  await fs.mkdir(workspace);
  await fs.mkdir(data);
  after(() => fs.rm(base, { recursive: true, force: true }));
  return { base, workspace, data };
}

export async function writeFile(root: string, relative: string, content: string) {
  const target = path.join(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return target;
}
