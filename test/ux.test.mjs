import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
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

await test("警告だけのレポートは既定ではブロックしない", () => {
  const report = {
    findings: [{ severity: "warning" }],
  };
  assert.equal(hasBlockingFindings(report), false);
  assert.equal(hasBlockingFindings(report, { failOn: "warning" }), true);
});

await test("AIが修正できない指摘は手作業として表示する", () => {
  const output = formatHarnessReport({
    documents: [{ path: "docs/design.md" }],
    findings: [
      {
        document: "docs/design.md",
        ruleId: "semantic/check-1",
        severity: "error",
        resolution: "agent",
        message: "構成の入れ替えが必要です",
        location: null,
        repairableByAgent: false,
      },
    ],
    summary: { documents: 1, findings: 1, errors: 1, warnings: 0, infos: 0 },
  });

  assert.match(output, /\[手作業で修正\]/);
  assert.match(output, /手作業での修正が必要な指摘: 1件/);
});

await test("GitリポジトリとMarkdownの対象を安全に解決する", async () => {
  // macOSのos.tmpdir()はsymlinkのため、Gitが返す実体パスへ揃うことも確認する。
  const workspace = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-scope-"));
  const repository = path.join(await realpath(workspace), "project");
  const document = path.join(workspace, "project", "docs", "design.md");

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
      () => resolveDocumentScope({ projectDir: workspace, target: "../outside.md" }),
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

    // Gitに属さないMarkdownは、1件指定に限りファイルのディレクトリを境界にする。
    const notes = path.join(await realpath(workspace), "notes");
    await mkdir(path.join(workspace, "notes"));
    await writeFile(path.join(workspace, "notes", "memo.md"), "# メモ\n", "utf8");
    assert.deepEqual(resolveDocumentScope({ projectDir: workspace, target: "notes/memo.md" }), {
      cwd: notes,
      files: ["memo.md"],
    });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
