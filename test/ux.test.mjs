import assert from "node:assert/strict";
import test from "node:test";
import {
  formatHarnessReport,
  hasBlockingFindings,
} from "../lib/core/human-report.mjs";

await test("formatHarnessReportは成功時にも検査結果を表示する", () => {
  const output = formatHarnessReport({
    documents: [{ path: "README.md" }],
    findings: [],
    summary: { documents: 1, findings: 0, errors: 0, warnings: 0, infos: 0 },
  });

  assert.equal(output, "Markdown 1件を検査しました。問題はありません。");
});

await test("formatHarnessReportは重要度と解決主体をまとめる", () => {
  const report = {
    documents: [{ path: "docs/design.md" }],
    findings: [
      {
        document: "docs/design.md",
        ruleId: "contract/schema/required",
        severity: "error",
        resolution: "agent",
        message: "必須項目がありません",
        location: { startLine: 3, startColumn: 1 },
        repairableByAgent: true,
      },
      {
        document: "docs/design.md",
        ruleId: "accountability/reason",
        severity: "warning",
        resolution: "needs_author",
        message: "採用理由を確認できません",
        location: null,
        repairableByAgent: false,
      },
      {
        document: "docs/design.md",
        ruleId: "grounding/claim-1",
        severity: "info",
        resolution: "uncertain",
        message: "資料だけでは判断できません",
        location: null,
        repairableByAgent: false,
      },
    ],
    summary: { documents: 1, findings: 3, errors: 1, warnings: 1, infos: 1 },
  };

  const output = formatHarnessReport(report);
  assert.match(output, /エラー 1件、警告 1件、情報 1件/);
  assert.match(output, /docs\/design\.md:3:1/);
  assert.match(output, /\[AIで修正可能\]/);
  assert.match(output, /\[書き手に確認\]/);
  assert.match(output, /\[要確認\]/);
  assert.match(output, /書き手の入力が必要な指摘: 1件/);
  assert.equal(hasBlockingFindings(report), true);
});

await test("警告だけのレポートはブロックしない", () => {
  const report = {
    findings: [{ severity: "warning" }],
  };
  assert.equal(hasBlockingFindings(report), false);
});
