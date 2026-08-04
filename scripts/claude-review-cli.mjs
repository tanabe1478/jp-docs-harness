import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { compareRunReports } from "../lib/eval/compare-run-reports.mjs";
import { evaluateCorpusRun, prepareCorpusRun } from "../lib/eval/corpus-run.mjs";
import { prepareReviewPackets } from "../lib/semantic/prepare-review.mjs";
import { snapshotUrlSources } from "../lib/semantic/snapshot-sources.mjs";
import {
  createReviewResultValidator,
  inspectStoredReview,
  loadJsonFile,
  recordReviewResult,
  validateReviewResult,
} from "../lib/semantic/review-result.mjs";
import { resolvePluginContext } from "./plugin-context.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

try {
  const [command, ...args] = process.argv.slice(2);
  const { pluginRoot, requireFromData } = resolvePluginContext({ packageRoot });
  const yamlPath = requireFromData.resolve("yaml");
  const ajvPath = requireFromData.resolve("ajv/dist/2020.js");
  const yaml = await import(pathToFileURL(yamlPath).href);
  const { default: Ajv } = await import(pathToFileURL(ajvPath).href);
  const intentSchemaPath = path.join(pluginRoot, "schemas", "intent.schema.json");
  const reviewPacketSchemaPath = path.join(pluginRoot, "schemas", "review-packet.schema.json");
  const reviewResultSchemaPath = path.join(pluginRoot, "schemas", "review-result.schema.json");

  if (command === "eval-diff") {
    if (args.length !== 2) fail("eval-diffにはbaselineとcandidateのreportを指定してください");
    const baseline = await loadJsonFile(path.resolve(cwd, args[0]));
    const candidate = await loadJsonFile(path.resolve(cwd, args[1]));
    process.stdout.write(`${JSON.stringify(compareRunReports(baseline, candidate), null, 2)}\n`);
  } else if (command === "eval-prepare") {
    if (args.length !== 1) fail("eval-prepareには出力ディレクトリを指定してください");
    const manifest = await prepareCorpusRun({
      cwd: pluginRoot,
      corpusRoot: path.join(pluginRoot, "eval", "cases"),
      outputDir: path.resolve(cwd, args[0]),
      prepareReviewPackets,
      yaml,
      Ajv,
      intentSchemaPath,
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else if (command === "eval-suite") {
    if (args.length !== 1) fail("eval-suiteにはcandidateディレクトリを指定してください");
    const validateResult = await createReviewResultValidator({ Ajv, reviewResultSchemaPath });
    const report = await evaluateCorpusRun({
      corpusRoot: path.join(pluginRoot, "eval", "cases"),
      candidateDir: path.resolve(cwd, args[0]),
      validateResult,
      inspectCandidate: async ({ caseId, candidate, candidateDir }) => {
        const packetPath = path.join(candidateDir, `${caseId}.packet.json`);
        if (!existsSync(packetPath)) return [`review packetがありません: ${packetPath}`];
        const packet = await loadJsonFile(packetPath);
        return validateReviewResult({ result: candidate, packet, validate: validateResult });
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode =
      report.corpus.missingCases.length === 0 &&
      report.corpus.invalidCases.length === 0 &&
      !report.corpus.mixedJudges
        ? 0
        : 1;
  } else if (command === "prepare") {
    if (args.length !== 1) fail("prepareにはMarkdownファイルを1件指定してください");
    const [packet] = await prepareReviewPackets({ cwd, files: args, yaml, Ajv, intentSchemaPath });
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
  } else if (command === "snapshot") {
    if (args.length !== 1) fail("snapshotにはMarkdownファイルを1件指定してください");
    const [packet] = await prepareReviewPackets({ cwd, files: args, yaml, Ajv, intentSchemaPath });
    const snapshots = await snapshotUrlSources({
      cwd,
      sources: packet.contract.evidence.sources ?? [],
    });
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, snapshots }, null, 2)}\n`);
  } else if (command === "record") {
    if (args.length !== 2) fail("recordにはpacketとresultを指定してください");
    const packet = await loadJsonFile(path.resolve(cwd, args[0]));
    const result = await loadJsonFile(path.resolve(cwd, args[1]));
    const destination = await recordReviewResult({
      cwd,
      packet,
      result,
      Ajv,
      reviewPacketSchemaPath,
      reviewResultSchemaPath,
    });
    process.stdout.write(`${path.relative(cwd, destination).split(path.sep).join("/")}\n`);
  } else if (command === "verify") {
    if (args.length !== 1) fail("verifyにはMarkdownファイルを1件指定してください");
    const [packet] = await prepareReviewPackets({ cwd, files: args, yaml, Ajv, intentSchemaPath });
    const verification = await inspectStoredReview({ cwd, packet, Ajv, reviewResultSchemaPath });
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    process.exitCode = verification.status === "fresh" ? 0 : 1;
  } else {
    fail(`不明なコマンドです: ${command ?? ""}`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function fail(message) {
  process.stderr.write(`jp-docs-harness: ${message}\n`);
  process.exit(2);
}
