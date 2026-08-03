import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveDocumentScope } from "../lib/core/document-scope.mjs";
import {
  formatHarnessReport,
  hasBlockingFindings,
} from "../lib/core/human-report.mjs";

await test("formatHarnessReportは成功時にも検査結果と意味レビュー状態を表示する", () => {
  const output = formatHarnessReport({
    documents: [{ path: "README.md" }],
    findings: [],
    summary: { documents: 1, findings: 0, errors: 0, warnings: 0, infos: 0 },
  });

  assert.equal(
    output,
    "Markdown 1件を検査しました。問題はありません。\n意味レビュー: 未実行 1件（重要文書にはreview-docsを使用）",
  );
});

await test("formatHarnessReportは最新の意味レビューを区別する", () => {
  const output = formatHarnessReport({
    documents: [{ path: "README.md", review: { status: "fresh" } }],
    findings: [],
    summary: { documents: 1, findings: 0, errors: 0, warnings: 0, infos: 0 },
  });

  assert.match(output, /意味レビュー: 最新 1件/);
  assert.doesNotMatch(output, /review-docsを使用/);
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

await test("GitリポジトリとMarkdownの対象を安全に解決する", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-scope-"));
  const repository = path.join(workspace, "project");
  const document = path.join(repository, "docs", "design.md");

  try {
    await mkdir(path.dirname(document), { recursive: true });
    await writeFile(document, "# Design\n", "utf8");
    await writeFile(path.join(repository, "src.ts"), "export {};\n", "utf8");
    execFileSync("git", ["init", repository], { stdio: "ignore" });

    assert.deepEqual(resolveDocumentScope({ projectDir: workspace, target: "project" }), {
      cwd: repository,
      files: [],
    });
    assert.deepEqual(
      resolveDocumentScope({ projectDir: workspace, target: "project/docs/design.md" }),
      {
        cwd: repository,
        files: ["docs/design.md"],
      },
    );
    assert.deepEqual(resolveDocumentScope({ projectDir: path.join(repository, "docs") }), {
      cwd: repository,
      files: [],
    });

    assert.throws(
      () => resolveDocumentScope({ projectDir: repository, target: "../outside.md" }),
      /プロジェクト外/,
    );
    assert.throws(
      () => resolveDocumentScope({ projectDir: repository, target: "src.ts" }),
      /MarkdownファイルまたはGitリポジトリ/,
    );
    assert.throws(
      () => resolveDocumentScope({ projectDir: workspace }),
      /Gitリポジトリを特定できません/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
