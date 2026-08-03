import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import * as textlint from "textlint";
import * as yaml from "yaml";
import { hashContent } from "../lib/core/content-hash.mjs";
import { compareReviewResults } from "../lib/eval/compare-review-results.mjs";
import { compareRunReports } from "../lib/eval/compare-run-reports.mjs";
import { evaluateCorpusRun, prepareCorpusRun } from "../lib/eval/corpus-run.mjs";
import { createSurfaceFinding } from "../lib/core/finding.mjs";
import { resolveTargetPatterns } from "../lib/core/target-files.mjs";
import { runHarness } from "../lib/run-harness.mjs";
import { compileRubric } from "../lib/semantic/compile-rubric.mjs";
import { prepareReviewPackets } from "../lib/semantic/prepare-review.mjs";
import {
  assertPublicHttpUrl,
  snapshotUrlSources,
} from "../lib/semantic/snapshot-sources.mjs";
import {
  inspectStoredReview,
  recordReviewResult,
} from "../lib/semantic/review-result.mjs";

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
      yaml,
      Ajv,
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

await test("runHarnessは文書契約を検証して契約ハッシュを記録する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-contract-"));
  try {
    await writeFile(path.join(cwd, "article.md"), "# 検証対象\n");
    await writeFile(
      path.join(cwd, "article.md.intent.yml"),
      `version: 1
profile: technical-explainer
audience:
  problem: 読者が導入方法を判断できない
reader_delta:
  know: [検査内容]
  decide: [導入の可否]
  do: [検査の実行]
requirements:
  critical: [実行方法]
`,
    );

    const result = await runHarness({
      textlint,
      yaml,
      Ajv,
      cwd,
      files: ["article.md"],
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    });

    assert.equal(result.report.findings.length, 0);
    assert.equal(result.report.documents[0].contract.status, "valid");
    assert.match(result.report.documents[0].contract.contractHash, /^sha256:[a-f0-9]{64}$/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("Contract gateはSchema違反を行番号付きで報告する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-invalid-contract-"));
  try {
    await writeFile(path.join(cwd, "article.md"), "# 検証対象\n");
    await writeFile(
      path.join(cwd, "article.md.intent.yml"),
      `version: 1
profile: unknown-profile
audience:
  problem: 読者の問題
reader_delta:
  know: []
  decide: []
  do: []
requirements:
  critical: [必須内容]
`,
    );

    const result = await runHarness({
      textlint,
      yaml,
      Ajv,
      cwd,
      files: ["article.md"],
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    });

    const finding = result.report.findings.find((item) => item.ruleId === "contract/schema/enum");
    assert.ok(finding);
    assert.equal(finding.location.startLine, 2);
    assert.equal(result.report.documents[0].contract.status, "invalid");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("strict modeは文書契約の欠落をneeds_authorとして報告する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-strict-"));
  try {
    await writeFile(path.join(cwd, "article.md"), "# 検証対象\n");
    const result = await runHarness({
      textlint,
      yaml,
      Ajv,
      cwd,
      files: ["article.md"],
      reviewMode: "strict",
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    });

    assert.equal(result.report.findings[0].ruleId, "contract/missing");
    assert.equal(result.report.findings[0].resolution, "needs_author");
    assert.equal(result.report.findings[0].repairableByAgent, false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("compileRubricは型付き要件を決定論的なチェックへ変換する", () => {
  const contract = {
    requirements: [
      {
        id: "install-flow",
        importance: "answer-critical",
        type: "process",
        description: "導入手順",
        ordered_steps: [
          { text: "marketplaceを追加する", mandatory: true },
          { text: "Pluginをインストールする", mandatory: true },
          { text: "Pluginを再読み込みする", mandatory: false },
        ],
      },
      {
        id: "choices",
        importance: "answer-critical",
        type: "flexible-list",
        description: "選択肢",
        items: ["A", "B", "C"],
        baseline: 2,
      },
    ],
    evidence: { author_only: ["導入を決めた理由"] },
  };

  const first = compileRubric(contract);
  const second = compileRubric(contract);
  assert.deepEqual(first, second);
  assert.equal(first.checks.filter((check) => check.metaRubricId === "install-flow").length, 5);
  assert.equal(first.checks.find((check) => check.id === "choices-baseline").importance, "answer-critical");
  assert.equal(first.checks.find((check) => check.id === "choices-item-1").importance, "valuable");
  assert.deepEqual(first.authorOnly, ["導入を決めた理由"]);
});

await test("prepareReviewPacketsは本文、契約、コンパイル済みチェックをまとめる", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-prepare-"));
  try {
    await writeFile(path.join(cwd, "guide.md"), "# 導入ガイド\n");
    await writeFile(
      path.join(cwd, "guide.md.intent.yml"),
      `version: 1
profile: tutorial
audience:
  problem: 導入方法が分からない
reader_delta:
  know: [必要な手順]
  decide: [導入の可否]
  do: [Pluginの導入]
requirements:
  critical: [インストール手順]
evidence:
  author_only: [このツールを採用した理由]
`,
    );

    const [packet] = await prepareReviewPackets({
      yaml,
      Ajv,
      cwd,
      files: ["guide.md"],
      intentSchemaPath: path.join(projectRoot, "schemas", "intent.schema.json"),
    });

    assert.equal(packet.document.path, "guide.md");
    assert.equal(packet.contract.profile, "tutorial");
    assert.equal(packet.rubric.checks[0].id, "critical-001-fact");
    assert.deepEqual(packet.rubric.authorOnly, ["このツールを採用した理由"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("recordとverifyは完全な結果を保存し本文変更後にstaleを返す", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-review-"));
  try {
    await writeFile(path.join(cwd, "guide.md"), "# 導入ガイド\n手順を説明します。\n");
    await writeFile(
      path.join(cwd, "guide.md.intent.yml"),
      `version: 1
profile: tutorial
audience:
  problem: 導入方法が分からない
reader_delta:
  know: [必要な手順]
  decide: [導入の可否]
  do: [Pluginの導入]
requirements:
  critical: [インストール手順]
evidence:
  author_only: [採用した理由]
`,
    );
    const prepare = () =>
      prepareReviewPackets({
        yaml,
        Ajv,
        cwd,
        files: ["guide.md"],
        intentSchemaPath: path.join(projectRoot, "schemas", "intent.schema.json"),
      });
    const [packet] = await prepare();
    const result = {
      schemaVersion: 2,
      document: { path: packet.document.path, contentHash: packet.document.contentHash },
      contract: { path: packet.contract.path, contractHash: packet.contract.contractHash },
      rubricHash: packet.rubric.rubricHash,
      evidenceHash: packet.grounding.evidenceHash,
      judge: { provider: "test", model: "test-model", promptVersion: "2" },
      evaluations: packet.rubric.checks.map((check, index) => ({
        checkId: check.id,
        verdict: index === 0 ? "missing" : "meets",
        resolution: index === 0 ? "agent" : "none",
        justification: index === 0 ? "必要な手順が不足している" : "本文の2行目で確認できる",
        location: index === 0 ? null : { startLine: 2, endLine: 2 },
        claimIds: [],
        repairableByAgent: index === 0,
      })),
      authorEvaluations: packet.rubric.authorOnly.map((item) => ({
        item,
        status: "missing",
        justification: "本文に書き手の理由がない",
        location: null,
      })),
      groundingCoverage: {
        status: "no_verifiable_claims",
        justification: "外部検証可能な主張はない",
      },
      claimEvaluations: [],
    };

    await recordReviewResult({
      cwd,
      packet,
      result,
      Ajv,
      reviewPacketSchemaPath: path.join(projectRoot, "schemas", "review-packet.schema.json"),
      reviewResultSchemaPath: path.join(projectRoot, "schemas", "review-result.schema.json"),
    });
    const fresh = await inspectStoredReview({
      cwd,
      packet,
      Ajv,
      reviewResultSchemaPath: path.join(projectRoot, "schemas", "review-result.schema.json"),
    });
    assert.equal(fresh.status, "fresh");

    const harnessResult = await runHarness({
      textlint,
      yaml,
      Ajv,
      cwd,
      files: ["guide.md"],
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    });
    assert.ok(harnessResult.report.findings.some((finding) => finding.ruleId.startsWith("semantic/")));
    assert.ok(
      harnessResult.report.findings.some(
        (finding) => finding.ruleId.startsWith("accountability/") && finding.resolution === "needs_author",
      ),
    );

    await writeFile(path.join(cwd, "guide.md"), "# 導入ガイド\n変更した本文です。\n");
    const [changedPacket] = await prepare();
    const stale = await inspectStoredReview({
      cwd,
      packet: changedPacket,
      Ajv,
      reviewResultSchemaPath: path.join(projectRoot, "schemas", "review-result.schema.json"),
    });
    assert.equal(stale.status, "stale");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("Groundingはローカル根拠を検証し資料変更後にstaleを返す", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-grounding-"));
  try {
    await writeFile(path.join(cwd, "result.txt"), "測定結果: 処理時間は10ms\n");
    await writeFile(path.join(cwd, "performance.md"), "# 性能\n処理時間は10msです。\n");
    await writeFile(
      path.join(cwd, "performance.md.intent.yml"),
      `version: 1
profile: technical-explainer
audience:
  problem: 性能が分からない
reader_delta:
  know: [処理時間]
  decide: []
  do: []
requirements:
  - id: latency
    importance: answer-critical
    type: simple-knowledge
    description: 処理時間
    fact: 処理時間は10ms
    source_ids: [benchmark]
evidence:
  sources:
    - id: benchmark
      path: result.txt
`,
    );
    const prepare = () =>
      prepareReviewPackets({
        yaml,
        Ajv,
        cwd,
        files: ["performance.md"],
        intentSchemaPath: path.join(projectRoot, "schemas", "intent.schema.json"),
      });
    const [packet] = await prepare();
    assert.equal(packet.grounding.sources[0].status, "loaded");
    assert.equal(packet.rubric.checks[0].sourcePolicy, "required");
    const result = {
      schemaVersion: 2,
      document: { path: packet.document.path, contentHash: packet.document.contentHash },
      contract: { path: packet.contract.path, contractHash: packet.contract.contractHash },
      rubricHash: packet.rubric.rubricHash,
      evidenceHash: packet.grounding.evidenceHash,
      judge: { provider: "test", model: "test-model", promptVersion: "2" },
      evaluations: packet.rubric.checks.map((check) => ({
        checkId: check.id,
        verdict: "meets",
        resolution: "none",
        justification: "根拠資料と一致する",
        location: { startLine: 2, endLine: 2 },
        claimIds: ["claim-001"],
        repairableByAgent: false,
      })),
      authorEvaluations: [],
      groundingCoverage: {
        status: "reviewed",
        justification: "性能に関する主張を確認した",
      },
      claimEvaluations: [
        {
          claimId: "claim-001",
          text: "処理時間は10msです。",
          kind: "factual",
          verdict: "supported",
          resolution: "none",
          justification: "benchmarkの1行目に測定結果がある",
          location: { startLine: 2, endLine: 2 },
          evidence: [{ sourceId: "benchmark", startLine: 1, endLine: 1 }],
          repairableByAgent: false,
        },
      ],
    };
    const unlinked = structuredClone(result);
    unlinked.evaluations[0].claimIds = [];
    await assert.rejects(
      recordReviewResult({
        cwd,
        packet,
        result: unlinked,
        Ajv,
        reviewPacketSchemaPath: path.join(projectRoot, "schemas", "review-packet.schema.json"),
        reviewResultSchemaPath: path.join(projectRoot, "schemas", "review-result.schema.json"),
      }),
      /根拠必須の判定にclaimIdsがありません/,
    );
    await recordReviewResult({
      cwd,
      packet,
      result,
      Ajv,
      reviewPacketSchemaPath: path.join(projectRoot, "schemas", "review-packet.schema.json"),
      reviewResultSchemaPath: path.join(projectRoot, "schemas", "review-result.schema.json"),
    });

    await writeFile(path.join(cwd, "result.txt"), "測定結果: 処理時間は20ms\n");
    const [changedPacket] = await prepare();
    const stale = await inspectStoredReview({
      cwd,
      packet: changedPacket,
      Ajv,
      reviewResultSchemaPath: path.join(projectRoot, "schemas", "review-result.schema.json"),
    });
    assert.equal(stale.status, "stale");
    assert.ok(stale.reasons.some((reason) => reason.includes("evidenceHash")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("URL snapshotは明示的に取得され、改ざんとprivate URLを拒否する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-snapshot-"));
  try {
    await writeFile(path.join(cwd, "guide.md"), "# 仕様\n上限は10件です。\n");
    await writeFile(
      path.join(cwd, "guide.md.intent.yml"),
      `version: 1
profile: reference
audience:
  problem: 上限が分からない
reader_delta:
  know: [上限]
  decide: []
  do: []
requirements:
  - id: limit
    importance: answer-critical
    type: simple-knowledge
    description: 上限
    fact: 上限は10件
    source_ids: [spec]
evidence:
  sources:
    - id: spec
      url: https://docs.example.test/spec
`,
    );
    const prepare = () =>
      prepareReviewPackets({
        yaml,
        Ajv,
        cwd,
        files: ["guide.md"],
        intentSchemaPath: path.join(projectRoot, "schemas", "intent.schema.json"),
      });
    const [external] = await prepare();
    assert.equal(external.grounding.sources[0].status, "external");
    const missingSnapshot = await runHarness({
      textlint,
      yaml,
      Ajv,
      cwd,
      files: ["guide.md"],
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    });
    assert.ok(
      missingSnapshot.report.findings.some(
        (finding) => finding.ruleId === "evidence/external" && finding.resolution === "agent",
      ),
    );

    await snapshotUrlSources({
      cwd,
      sources: external.contract.evidence.sources,
      assertSafeUrl: async () => {},
      now: () => "2026-01-01T00:00:00.000Z",
      fetchImpl: async () =>
        new Response("仕様上限: 10件\n", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    });
    const [loaded] = await prepare();
    assert.equal(loaded.grounding.sources[0].status, "loaded");
    const stableHash = loaded.grounding.evidenceHash;

    const snapshotPath = path.join(cwd, loaded.grounding.sources[0].snapshotPath);
    await writeFile(snapshotPath, "改ざんされた内容\n");
    const [invalid] = await prepare();
    assert.equal(invalid.grounding.sources[0].status, "invalid-snapshot");

    await snapshotUrlSources({
      cwd,
      sources: external.contract.evidence.sources,
      assertSafeUrl: async () => {},
      now: () => "2026-02-01T00:00:00.000Z",
      fetchImpl: async () => new Response("仕様上限: 10件\n", { status: 200 }),
    });
    const [resnapshotted] = await prepare();
    assert.equal(resnapshotted.grounding.evidenceHash, stableHash);
    await assert.rejects(assertPublicHttpUrl("http://127.0.0.1/private"), /private network/);
    await assert.rejects(assertPublicHttpUrl("https://localhost/spec"), /localhost/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("contracted modeは意味レビューの欠落を報告する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-contracted-"));
  try {
    await writeFile(path.join(cwd, "guide.md"), "# 導入ガイド\n");
    await writeFile(
      path.join(cwd, "guide.md.intent.yml"),
      `version: 1
profile: tutorial
audience:
  problem: 導入方法が分からない
reader_delta:
  know: []
  decide: []
  do: []
requirements:
  critical: [インストール手順]
`,
    );
    const result = await runHarness({
      textlint,
      yaml,
      Ajv,
      cwd,
      files: ["guide.md"],
      reviewMode: "contracted",
      configFilePath: path.join(projectRoot, ".textlintrc.json"),
      nodeModulesDir: path.join(projectRoot, "node_modules"),
    });
    assert.equal(result.report.findings[0].ruleId, "freshness/missing");
    assert.equal(result.report.documents[0].review.status, "missing");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("evalはJudge結果を単一スコアにせず次元別に比較する", () => {
  const base = {
    document: { path: "doc.md", contentHash: `sha256:${"a".repeat(64)}` },
    contract: { path: "doc.md.intent.yml", contractHash: `sha256:${"b".repeat(64)}` },
    rubricHash: `sha256:${"c".repeat(64)}`,
    evidenceHash: `sha256:${"d".repeat(64)}`,
    judge: { provider: "test", model: "gold", promptVersion: "2" },
    evaluations: [
      { checkId: "check-1", verdict: "meets", resolution: "none" },
      { checkId: "check-2", verdict: "missing", resolution: "agent" },
    ],
    authorEvaluations: [{ item: "採用理由", status: "missing" }],
    groundingCoverage: { status: "reviewed" },
    claimEvaluations: [
      {
        claimId: "claim-001",
        text: "処理時間は10msです。",
        location: { startLine: 2, endLine: 2 },
        verdict: "supported",
        resolution: "none",
      },
    ],
  };
  const candidate = structuredClone(base);
  candidate.evaluations[1].verdict = "partially_meets";
  candidate.claimEvaluations[0].verdict = "unsupported";
  const report = compareReviewResults(base, candidate);
  assert.equal(report.dimensions.rubricVerdict.accuracy, 0.5);
  assert.equal(report.dimensions.groundingVerdict.accuracy, 0);
  assert.equal("score" in report, false);
});

await test("eval suiteはpacketを生成しcandidateを次元別に集計する", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "jp-docs-eval-suite-"));
  try {
    const corpusRoot = path.join(projectRoot, "eval", "cases");
    const manifest = await prepareCorpusRun({
      cwd: projectRoot,
      corpusRoot,
      outputDir,
      prepareReviewPackets,
      yaml,
      Ajv,
      intentSchemaPath: path.join(projectRoot, "schemas", "intent.schema.json"),
    });
    assert.equal(manifest.cases.length, 3);
    for (const item of manifest.cases) {
      const gold = await readFile(path.join(corpusRoot, item.id, "gold.json"), "utf8");
      await writeFile(path.join(outputDir, item.candidateFile), gold);
    }
    const report = await evaluateCorpusRun({ corpusRoot, candidateDir: outputDir });
    assert.equal(report.corpus.evaluatedCases, 3);
    assert.equal(report.corpus.missingCases.length, 0);
    assert.equal(report.corpus.mixedJudges, false);
    assert.equal(report.dimensions.groundingVerdict.accuracy, 1);
    assert.equal("score" in report, false);
    const regressed = structuredClone(report);
    regressed.dimensions.groundingVerdict.accuracy = 0.5;
    const diff = compareRunReports(report, regressed);
    assert.equal(diff.dimensions.groundingVerdict.delta, -0.5);
    assert.equal("score" in diff, false);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

await test("公開するJSON Schemaは有効なJSONである", async () => {
  for (const file of [
    "eval-run.schema.json",
    "evidence-lock.schema.json",
    "finding.schema.json",
    "report.schema.json",
    "intent.schema.json",
    "review-packet.schema.json",
    "review-result.schema.json",
  ]) {
    const content = await readFile(path.join(projectRoot, "schemas", file), "utf8");
    assert.doesNotThrow(() => JSON.parse(content));
  }
});
