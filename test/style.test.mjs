import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeDocumentStyle, styleGate } from "../lib/gates/style.mjs";

function ruleIds(findings) {
  return findings.map((finding) => finding.ruleId);
}

await test("1文に複数の太字がある場合に警告する", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content:
      "`resource_class: medium` は **2 vCPU / 4GB** で、この 4GB は**プライマリコンテナと全サービスコンテナの合計**である。\n",
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), ["style/bold-in-sentence"]);
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].location.startLine, 1);
});

await test("同じ行でも別の文に分かれた太字は警告しない", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content:
      "Playwright は**同梱ブラウザ**を使う。一見すると無駄なステップに見えるが、**共有ライブラリの供給源**として機能している。\n",
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), []);
});

await test("文全体が太字の場合に警告する", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: "**ローカル（macOS）では 2 件 11 秒で通ったが、CI では通らなかった。**\n",
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), ["style/bold-sentence"]);
});

await test("太字が文書全体へ散ると密度の警告を1件出す", () => {
  const lines = Array.from(
    { length: 6 },
    (_, index) => `セクション${index}では**重要な点${index}**を説明する。`,
  );
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: `${lines.join("\n\n")}\n`,
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), ["style/bold-density"]);
  assert.match(findings[0].message, /太字が6箇所/);
  assert.equal(findings[0].location, null);
});

await test("書き手の評価・感想の定型表現を警告する", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: [
      "ローカル検証だけでは CI の挙動を保証できないという教訓。",
      "同じ原因なのに別の障害に見えるので注意が必要。",
      "バージョン更新のたびに再取得が必要になる点も押さえておきたい。",
      "さらに厄介なのは、テストクラスを 1 つ追加するだけでシャッフルされること。",
      "",
    ].join("\n"),
  });

  assert.deepEqual(
    ruleIds(findings),
    Array(4).fill("style/editorializing"),
  );
  assert.match(findings[0].message, /という教訓/);
  assert.equal(findings[1].location.startLine, 2);
});

await test("コードブロックとインラインコードは検査しない", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: [
      "```diff",
      "- **太字A**と**太字B**が同じ文にある。注意が必要。",
      "```",
      "",
      "分散対象が `**/*Test**` にマッチするのは既知の挙動である。",
      "",
    ].join("\n"),
  });

  assert.deepEqual(ruleIds(findings), []);
});

await test("問題のない文書には何も報告しない", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: "この文書は**一箇所だけ**を強調し、事実を淡々と述べる。\n",
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), []);
});

await test("既定では太字そのものを警告する", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: "この文書は**一箇所だけ**を強調している。\n",
  });

  assert.deepEqual(ruleIds(findings), ["style/bold-forbidden"]);
  assert.equal(findings[0].severity, "warning");
});

await test("allowでは太字を警告しない", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: "**文全体が太字でも許可される。**という教訓。\n",
    boldPolicy: "allow",
  });

  assert.deepEqual(ruleIds(findings), ["style/editorializing"]);
});

await test("文書契約のstyle.boldは実行時の既定より優先される", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-style-"));
  try {
    await writeFile(path.join(cwd, "memo.md"), "**強調**を使う。\n", "utf8");
    const documents = [
      { path: "memo.md", contract: { path: "memo.md.intent.yml", status: "valid", style: { bold: "allow" } } },
    ];

    const result = await styleGate.run({ cwd, documents, boldPolicy: "forbid" });
    assert.deepEqual(ruleIds(result.findings), []);

    const withoutContract = await styleGate.run({
      cwd,
      documents: [{ path: "memo.md" }],
      boldPolicy: "forbid",
    });
    assert.deepEqual(ruleIds(withoutContract.findings), ["style/bold-forbidden"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("LLM調の比喩と評価の定型表現を警告する", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: [
      "mainがフロントオリジン統一に寄せてあるので、この形が素直に嵌まる。",
      "セットアップの手間が最大の問題だった。",
      "SPAが読めなくてもAPIを直接叩けてしまうため意味がない。",
      "ALBの費用が固定費として効く。",
      "",
    ].join("\n"),
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), Array(4).fill("style/editorializing"));
});

await test("文脈依存の表現は決定論では警告しない", () => {
  const findings = analyzeDocumentStyle({
    document: "docs/report.md",
    content: [
      "実装は、この値を検査してはならない。",
      "この設定は公開するものではない。",
      "リストの順序に意味はない。",
      "キャッシュが効くため再取得は発生しない。",
      "",
    ].join("\n"),
    boldPolicy: "moderate",
  });

  assert.deepEqual(ruleIds(findings), []);
});
