import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeReadingLoad, readabilityGate } from "../lib/gates/readability.mjs";

function ruleIds(findings) {
  return findings.map((finding) => finding.ruleId);
}

await test("100文字を超える一文を指す", () => {
  const long = `${"この文は読点で区切られた内容を次々と繋いでいて、".repeat(5)}最後まで読まないと構造が分からない。`;
  const findings = analyzeReadingLoad({ document: "docs/report.md", content: `${long}\n` });

  assert.deepEqual(ruleIds(findings), ["readability/sentence-too-long"]);
  assert.equal(findings[0].severity, "info");
  assert.match(findings[0].message, /一文が\d+文字/);
});

await test("文の長さはMarkdown記法とURLを数えない", () => {
  const padding = "a".repeat(90);
  const content = `[表示は短い](https://example.com/${padding})テキストです。\n`;
  const findings = analyzeReadingLoad({ document: "docs/report.md", content });

  assert.deepEqual(ruleIds(findings), []);
});

await test("句点で終わらない長い行は文として数えない", () => {
  const content = `${"長い見出しやラベルのような行".repeat(10)}\n`;
  const findings = analyzeReadingLoad({ document: "docs/report.md", content });

  assert.deepEqual(ruleIds(findings), []);
});

await test("二重否定を指す", () => {
  const findings = analyzeReadingLoad({
    document: "docs/report.md",
    content: "この方法が使えなくはないが、既定にはしない。\n対応できないわけではない。\n",
  });

  assert.deepEqual(
    ruleIds(findings),
    Array(2).fill("readability/double-negative"),
  );
});

await test("「の」の3連鎖を指す", () => {
  const findings = analyzeReadingLoad({
    document: "docs/report.md",
    content: "検査結果の保存先の設定の既定値を変更する。\n",
  });

  assert.deepEqual(ruleIds(findings), ["readability/no-chain"]);
});

await test("こそあど言葉の「の」は連鎖に数えない", () => {
  const findings = analyzeReadingLoad({
    document: "docs/report.md",
    content: "このリポジトリの検査は、その結果を保存する。\n",
  });

  assert.deepEqual(ruleIds(findings), []);
});

await test("表の行とコードブロックは対象外", () => {
  const long = `${"セルの中の長い説明を書き続ける、".repeat(10)}終わり。`;
  const findings = analyzeReadingLoad({
    document: "docs/report.md",
    content: ["| 項目 | 説明 |", "| --- | --- |", `| a | ${long} |`, "", "```text", long, "なくはない", "```", ""].join("\n"),
  });

  assert.deepEqual(ruleIds(findings), []);
});

await test("readingLoadがoffのとき読解負荷は検査しない", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-rl-"));
  try {
    await writeFile(path.join(cwd, "memo.md"), "使えなくはない。\n", "utf8");

    const off = await readabilityGate.run({
      cwd,
      documents: [{ path: "memo.md" }],
      readingLoad: "off",
    });
    assert.deepEqual(ruleIds(off.findings), []);

    const on = await readabilityGate.run({
      cwd,
      documents: [{ path: "memo.md" }],
      readingLoad: "check",
    });
    assert.deepEqual(ruleIds(on.findings), ["readability/double-negative"]);

    // 契約の宣言は実行時の既定より優先される。
    const contractWins = await readabilityGate.run({
      cwd,
      documents: [
        {
          path: "memo.md",
          contract: { path: "memo.md.intent.yml", status: "valid", style: { reading_load: "check" } },
        },
      ],
      readingLoad: "off",
    });
    assert.deepEqual(ruleIds(contractWins.findings), ["readability/double-negative"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
