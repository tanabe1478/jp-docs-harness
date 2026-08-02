import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as textlint from "textlint";
import { hashContent } from "../lib/core/content-hash.mjs";
import { createSurfaceFinding } from "../lib/core/finding.mjs";
import { resolveTargetPatterns } from "../lib/core/target-files.mjs";
import { runHarness } from "../lib/run-harness.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

await test("hashContentは同じ内容から安定したSHA-256を生成する", () => {
  assert.equal(
    hashContent("日本語"),
    "sha256:77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5",
  );
});

await test("resolveTargetPatternsは重複を除きプロジェクト外を拒否する", () => {
  assert.deepEqual(
    resolveTargetPatterns({ cwd: "/workspace", files: ["b.md", "a.md", "a.md", "memo.txt"] }),
    ["a.md", "b.md"],
  );
  assert.throws(
    () => resolveTargetPatterns({ cwd: "/workspace", files: ["../outside.md"] }),
    /プロジェクト外/,
  );
});

await test("createSurfaceFindingはtextlintの指摘を共通形式へ変換する", () => {
  const finding = createSurfaceFinding({
    document: "docs/example.md",
    message: {
      ruleId: "example-rule",
      severity: 2,
      message: "検査メッセージ",
      line: 3,
      column: 5,
      loc: { start: { line: 3, column: 5 }, end: { line: 3, column: 8 } },
    },
  });

  assert.equal(finding.gate, "surface");
  assert.equal(finding.severity, "error");
  assert.equal(finding.document, "docs/example.md");
  assert.deepEqual(finding.location, {
    startLine: 3,
    startColumn: 5,
    endLine: 3,
    endColumn: 8,
  });
});

await test("runHarnessは指定したMarkdownだけを決定論的なJSONへ変換する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-harness-"));
  try {
    await writeFile(path.join(cwd, "target.md"), "- **重要**: 革命的な技術です。\n");
    await writeFile(path.join(cwd, "other.md"), "- **注意**: 究極の方法です。\n");

    const options = {
      textlint,
      cwd,
      files: ["target.md"],
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    };
    const first = await runHarness(options);
    const second = await runHarness(options);

    assert.equal(first.report.documents.length, 1);
    assert.equal(first.report.documents[0].path, "target.md");
    assert.ok(first.report.findings.length >= 1);
    assert.ok(first.report.findings.every((finding) => finding.document === "target.md"));
    assert.deepEqual(first.report, second.report);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("公開するJSON Schemaは有効なJSONである", async () => {
  for (const file of ["finding.schema.json", "report.schema.json"]) {
    const content = await readFile(path.join(projectRoot, "schemas", file), "utf8");
    assert.doesNotThrow(() => JSON.parse(content));
  }
});
