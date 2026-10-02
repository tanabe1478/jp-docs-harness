import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import * as textlint from "textlint";
import * as yaml from "yaml";
import {
  describeDocumentContract,
  inspectContractConfirmation,
  recordContractConfirmation,
} from "../lib/core/contract-confirmation.mjs";
import { runHarness } from "../lib/run-harness.mjs";
import { compileRubric } from "../lib/semantic/compile-rubric.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const intentSchemaPath = path.join(projectRoot, "schemas", "intent.schema.json");

const CONTRACT = `version: 1
profile: decision-proposal
preset: decision-proposal
audience:
  knows: [現行の検索基盤]
  problem: 検索基盤を刷新すべきか判断できない
reader_delta:
  know: [提案する結論と理由]
  decide: [刷新を進めるか]
  do: []
requirements:
  critical: [提案する結論, 検討した代替案と採らなかった理由]
evidence:
  author_only: [移行先を選んだ判断の理由]
`;

const harness = (cwd, reviewMode = "manual") =>
  runHarness({
    textlint,
    yaml,
    Ajv,
    cwd,
    files: ["proposal.md"],
    reviewMode,
    configFilePath: path.join(projectRoot, ".textlintrc.json"),
    nodeModulesDir: path.join(projectRoot, "node_modules"),
  });

await test("文書契約の確認は内容に結び付き、本文がなくても記録できる", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-confirm-"));
  try {
    await writeFile(path.join(cwd, "proposal.md.intent.yml"), CONTRACT);
    const describe = () =>
      describeDocumentContract({ cwd, file: "./proposal.md", yaml, Ajv, intentSchemaPath });

    const before = await describe();
    assert.equal(before.documentPath, "proposal.md");
    assert.equal(before.confirmation, "unconfirmed");
    assert.match(before.summary, /^文書契約: proposal\.md\.intent\.yml（未確認）/);
    assert.match(before.summary, /種類: decision-proposal（プリセット decision-proposal）/);
    assert.match(before.summary, /書き手にしか書けないこと:\n {2}- 移行先を選んだ判断の理由/);

    await recordContractConfirmation({ cwd, ...before, now: "2026-10-02T00:00:00.000Z" });
    assert.equal((await describe()).confirmation, "confirmed");

    // 確認後に契約を書き換えると、書き手が見ていない内容になるため確認は外れる。
    await writeFile(path.join(cwd, "proposal.md.intent.yml"), CONTRACT.replace("刷新を進めるか", "刷新を中止するか"));
    const changed = await describe();
    assert.equal(changed.confirmation, "changed");
    assert.equal(
      (await inspectContractConfirmation({ cwd, documentPath: "proposal.md", contractHash: changed.contractHash }))
        .status,
      "changed",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("検査は契約の確認状態を表示し、契約を求めるモードでだけ指摘する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-confirm-gate-"));
  try {
    await writeFile(path.join(cwd, "proposal.md"), "# 検索基盤の刷新\n\n刷新を提案します。\n");
    await writeFile(path.join(cwd, "proposal.md.intent.yml"), CONTRACT);

    const manual = await harness(cwd);
    assert.equal(manual.report.documents[0].contract.confirmation, "unconfirmed");
    assert.equal(manual.report.findings.some((finding) => finding.ruleId.startsWith("contract/")), false);
    assert.match(manual.humanOutput, /文書契約: 未確認 1件（書き手の確認にはreview-docsを使用）/);

    const strict = await harness(cwd, "strict");
    const unconfirmed = strict.report.findings.find((finding) => finding.ruleId === "contract/unconfirmed");
    assert.equal(unconfirmed.severity, "error");
    assert.equal(unconfirmed.resolution, "needs_author");
    assert.equal(unconfirmed.repairableByAgent, false);

    const contract = await describeDocumentContract({ cwd, file: "proposal.md", yaml, Ajv, intentSchemaPath });
    await recordContractConfirmation({ cwd, ...contract });
    const confirmed = await harness(cwd, "strict");
    assert.equal(confirmed.report.documents[0].contract.confirmation, "confirmed");
    assert.equal(confirmed.report.findings.some((finding) => finding.ruleId.startsWith("contract/")), false);
    assert.match(confirmed.humanOutput, /文書契約: 確認済み 1件\n/);

    // 契約のない文書しかないリポジトリでは、契約の行を出さない。
    await rm(path.join(cwd, "proposal.md.intent.yml"));
    assert.doesNotMatch((await harness(cwd)).humanOutput, /文書契約:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

await test("同梱プリセットは契約Schemaと一致し、要件へ変換できる", async () => {
  const schema = JSON.parse(await readFile(intentSchemaPath, "utf8"));
  const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const files = (await readdir(path.join(projectRoot, "presets"))).filter((file) => file.endsWith(".yml"));
  assert.deepEqual(
    files.map((file) => file.replace(/\.yml$/, "")).sort(),
    [...schema.properties.preset.enum].sort(),
  );

  for (const file of files) {
    const preset = yaml.parse(await readFile(path.join(projectRoot, "presets", file), "utf8"));
    assert.equal(`${preset.name}.yml`, file);
    for (const field of ["title", "use_when"]) assert.ok(preset[field], `${file}: ${field}がありません`);
    // プリセットの観点だけで契約を組み立て、Schemaに通ることを確かめる。
    const contract = {
      version: 1,
      profile: preset.profile,
      preset: preset.name,
      audience: { problem: "読者が困っていること" },
      reader_delta: preset.reader_delta_hints,
      requirements: preset.requirements,
      evidence: { author_only: preset.author_only_hints },
      non_goals: preset.non_goals,
    };
    assert.ok(validate(contract), `${file}: ${JSON.stringify(validate.errors)}`);
    assert.ok(compileRubric(contract).checks.length > 0);
  }
});

await test("piのconfirm-contractは確認ダイアログで承認されたときだけ記録する", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "jp-docs-pi-confirm-"));
  try {
    await writeFile(path.join(cwd, "proposal.md.intent.yml"), CONTRACT);
    const script = `
      import { existsSync } from "node:fs";
      import extension from ${JSON.stringify(path.join(projectRoot, "extensions", "textlint-on-settle.ts"))};
      const commands = new Map();
      const messages = [];
      extension({
        registerCommand: (name, command) => commands.set(name, command),
        sendUserMessage: (message) => messages.push(message),
      });
      const shown = [];
      const ctx = (approve) => ({
        cwd: ${JSON.stringify(cwd)},
        ui: {
          input: async () => undefined,
          notify: (message) => shown.push(message),
          confirm: async (title, body) => { shown.push(title + "\\n" + body); return approve; },
        },
      });
      const recordPath = ${JSON.stringify(path.join(cwd, ".jp-docs-harness", "contracts", "proposal.md.confirmation.json"))};
      await commands.get("confirm-contract").handler("proposal.md", ctx(false));
      const recordedAfterReject = existsSync(recordPath);
      await commands.get("confirm-contract").handler("proposal.md", ctx(true));
      await commands.get("plan-docs").handler("proposal.md", ctx(true));
      console.log(JSON.stringify({ shown, messages, recordedAfterReject }));
    `;
    const output = execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { shown, messages, recordedAfterReject } = JSON.parse(output.trim().split("\n").at(-1));
    assert.equal(recordedAfterReject, false);
    assert.match(shown[0], /^この文書契約で確定しますか\n文書契約: proposal\.md\.intent\.yml（未確認）/);
    assert.match(shown[1], /未確認のまま/);
    assert.match(shown[3], /確認済みにしました/);
    const confirmation = JSON.parse(
      await readFile(path.join(cwd, ".jp-docs-harness", "contracts", "proposal.md.confirmation.json"), "utf8"),
    );
    assert.equal(confirmation.document, "proposal.md");
    const confirmationSchema = JSON.parse(
      await readFile(path.join(projectRoot, "schemas", "contract-confirmation.schema.json"), "utf8"),
    );
    const validateConfirmation = new Ajv({ strict: false, validateFormats: false }).compile(confirmationSchema);
    assert.ok(validateConfirmation(confirmation), JSON.stringify(validateConfirmation.errors));
    assert.match(messages[0], /\/confirm-contract proposal\.md/);
    assert.match(messages[0], /AIが代わりにconfirmを実行してはいけません/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
