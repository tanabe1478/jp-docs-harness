import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "bin",
  "jp-docs-harness.mjs",
);

await test("--ai-wordsでAIが多用する語彙を警告し、既定では検査しない", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-ai-words-"));
  try {
    await writeFile(
      path.join(workspace, "memo.md"),
      "キャッシュの設定が効かない場合、リトライが静かに壊れる。\n",
      "utf8",
    );

    const withFlag = execFileSync("node", [cli, "check", "--ai-words", "memo.md"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.match(withFlag, /ai-words-ja\/no-ai-words/);
    assert.match(withFlag, /"効く"/);

    const withoutFlag = execFileSync("node", [cli, "check", "memo.md"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.match(withoutFlag, /問題はありません/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
