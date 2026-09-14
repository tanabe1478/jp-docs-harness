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

await test("AIが多用する語彙を既定で情報として指し、--no-ai-wordsで外せる", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-ai-words-"));
  try {
    await writeFile(
      path.join(workspace, "memo.md"),
      "キャッシュの設定が効かない場合、リトライが静かに壊れる。\n",
      "utf8",
    );

    // 既定で検出され、文脈判断が要るためinfo。--fail-on warningでもブロックしない。
    const output = execFileSync(
      "node",
      [cli, "check", "--fail-on", "warning", "memo.md"],
      { cwd: workspace, encoding: "utf8" },
    );
    assert.match(output, /情報 \d+件/);
    assert.match(output, /ai-words-ja\/no-ai-words/);
    assert.match(output, /"効く"/);
    assert.doesNotMatch(output, /警告/);

    const optedOut = execFileSync("node", [cli, "check", "--no-ai-words", "memo.md"], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.match(optedOut, /問題はありません/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
