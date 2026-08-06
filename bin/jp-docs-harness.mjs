#!/usr/bin/env node
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import * as textlint from "textlint";
import * as yaml from "yaml";
import { compareReviewResults } from "../lib/eval/compare-review-results.mjs";
import { compareRunReports } from "../lib/eval/compare-run-reports.mjs";
import { evaluateCorpusRun, prepareCorpusRun } from "../lib/eval/corpus-run.mjs";
import { runHarness } from "../lib/run-harness.mjs";
import { prepareReviewPackets } from "../lib/semantic/prepare-review.mjs";
import { snapshotUrlSources } from "../lib/semantic/snapshot-sources.mjs";
import {
  createReviewResultValidator,
  inspectStoredReview,
  loadJsonFile,
  recordReviewResult,
  validateReviewResult,
} from "../lib/semantic/review-result.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = path.resolve(process.cwd());
const configFilePath = path.join(packageRoot, ".textlintrc.json");
const intentSchemaPath = path.join(packageRoot, "schemas", "intent.schema.json");
const reviewPacketSchemaPath = path.join(packageRoot, "schemas", "review-packet.schema.json");
const reviewResultSchemaPath = path.join(packageRoot, "schemas", "review-result.schema.json");

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (options.command === "prepare") {
    if (options.files.length !== 1) {
      throw new Error("prepareにはMarkdownファイルを1件指定してください");
    }
    const packets = await prepareReviewPackets({
      yaml,
      Ajv,
      cwd,
      files: options.files,
      intentSchemaPath,
    });
    process.stdout.write(`${JSON.stringify(packets[0], null, 2)}\n`);
    process.exit(0);
  }

  if (options.command === "snapshot") {
    if (options.files.length !== 1) throw new Error("snapshotにはMarkdownファイルを1件指定してください");
    const [packet] = await prepareReviewPackets({
      yaml,
      Ajv,
      cwd,
      files: options.files,
      intentSchemaPath,
    });
    const snapshots = await snapshotUrlSources({
      cwd,
      sources: packet.contract.evidence.sources ?? [],
    });
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, snapshots }, null, 2)}\n`);
    process.exit(0);
  }

  if (options.command === "record") {
    if (options.files.length !== 2) {
      throw new Error("recordにはreview packetとレビュー結果のJSONを指定してください");
    }
    const packet = await loadJsonFile(path.resolve(cwd, options.files[0]));
    const reviewResult = await loadJsonFile(path.resolve(cwd, options.files[1]));
    const destination = await recordReviewResult({
      cwd,
      packet,
      result: reviewResult,
      Ajv,
      reviewPacketSchemaPath,
      reviewResultSchemaPath,
      outputPath: options.output,
    });
    process.stdout.write(`${path.relative(cwd, destination).split(path.sep).join("/")}\n`);
    process.exit(0);
  }

  if (options.command === "eval-diff") {
    if (options.files.length !== 2) throw new Error("eval-diffにはbaselineとcandidateのreportを指定してください");
    const baseline = await loadJsonFile(path.resolve(cwd, options.files[0]));
    const candidate = await loadJsonFile(path.resolve(cwd, options.files[1]));
    process.stdout.write(`${JSON.stringify(compareRunReports(baseline, candidate), null, 2)}\n`);
    process.exit(0);
  }

  if (options.command === "eval-prepare") {
    if (options.files.length !== 1) throw new Error("eval-prepareには出力ディレクトリを指定してください");
    const manifest = await prepareCorpusRun({
      cwd: packageRoot,
      corpusRoot: path.join(packageRoot, "eval", "cases"),
      outputDir: path.resolve(cwd, options.files[0]),
      prepareReviewPackets,
      yaml,
      Ajv,
      intentSchemaPath,
    });
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    process.exit(0);
  }

  if (options.command === "eval-suite") {
    if (options.files.length !== 1) throw new Error("eval-suiteにはcandidateディレクトリを指定してください");
    const validateResult = await createReviewResultValidator({ Ajv, reviewResultSchemaPath });
    const report = await evaluateCorpusRun({
      corpusRoot: path.join(packageRoot, "eval", "cases"),
      candidateDir: path.resolve(cwd, options.files[0]),
      validateResult,
      inspectCandidate: async ({ caseId, candidate, candidateDir }) => {
        const packetPath = path.join(candidateDir, `${caseId}.packet.json`);
        if (!existsSync(packetPath)) return [`review packetがありません: ${packetPath}`];
        const packet = await loadJsonFile(packetPath);
        return validateReviewResult({ result: candidate, packet, validate: validateResult });
      },
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(
      report.corpus.missingCases.length === 0 &&
        report.corpus.invalidCases.length === 0 &&
        !report.corpus.mixedJudges
        ? 0
        : 1,
    );
  }

  if (options.command === "eval") {
    if (options.files.length !== 2) throw new Error("evalにはgoldとcandidateのJSONを指定してください");
    const gold = await loadJsonFile(path.resolve(cwd, options.files[0]));
    const candidate = await loadJsonFile(path.resolve(cwd, options.files[1]));
    process.stdout.write(`${JSON.stringify(compareReviewResults(gold, candidate), null, 2)}\n`);
    process.exit(0);
  }

  if (options.command === "verify") {
    if (options.files.length !== 1) throw new Error("verifyにはMarkdownファイルを1件指定してください");
    const [packet] = await prepareReviewPackets({
      yaml,
      Ajv,
      cwd,
      files: options.files,
      intentSchemaPath,
    });
    const verification = await inspectStoredReview({
      cwd,
      packet,
      Ajv,
      reviewResultSchemaPath,
    });
    if (options.format === "json") {
      process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
    } else {
      process.stdout.write(`${packet.document.path}: ${verification.status}\n`);
      for (const reason of verification.reasons) process.stdout.write(`  ${reason}\n`);
    }
    process.exit(verification.status === "fresh" ? 0 : 1);
  }

  const result = await runHarness({
    textlint,
    yaml,
    Ajv,
    cwd,
    files: options.files,
    reviewMode: options.reviewMode,
    failOn: options.failOn,
    boldPolicy: options.boldPolicy,
    configFilePath,
    nodeModulesDir: path.join(packageRoot, "node_modules"),
    intentSchemaPath,
    reviewResultSchemaPath,
  });

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.humanOutput}\n`);
  }
  process.exit(result.hasBlocking ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function parseArguments(args) {
  const knownCommands = new Set([
    "check",
    "lint",
    "prepare",
    "snapshot",
    "record",
    "verify",
    "eval",
    "eval-prepare",
    "eval-suite",
    "eval-diff",
  ]);
  const hasCommand = knownCommands.has(args[0]);
  const rawCommand = hasCommand ? args[0] : "check";
  const command = rawCommand === "check" ? "lint" : rawCommand;
  const remaining = hasCommand ? args.slice(1) : [...args];
  const files = [];
  let format = "stylish";
  let help = false;
  let reviewMode = "manual";
  let failOn = "error";
  let boldPolicy = "forbid";
  let output;

  for (let index = 0; index < remaining.length; index += 1) {
    const argument = remaining[index];
    if (argument === "--json") {
      format = "json";
    } else if (argument === "--format") {
      const value = remaining[index + 1];
      if (value !== "json" && value !== "stylish") {
        throw new Error("--formatにはjsonまたはstylishを指定してください");
      }
      format = value;
      index += 1;
    } else if (argument === "--output") {
      output = remaining[index + 1];
      if (!output) throw new Error("--outputには保存先を指定してください");
      index += 1;
    } else if (argument === "--review-mode") {
      const value = remaining[index + 1];
      if (!["manual", "contracted", "strict"].includes(value)) {
        throw new Error("--review-modeにはmanual、contracted、strictのいずれかを指定してください");
      }
      reviewMode = value;
      index += 1;
    } else if (argument === "--bold") {
      const value = remaining[index + 1];
      if (!["forbid", "moderate", "allow"].includes(value)) {
        throw new Error("--boldにはforbid、moderate、allowのいずれかを指定してください");
      }
      boldPolicy = value;
      index += 1;
    } else if (argument === "--fail-on") {
      const value = remaining[index + 1];
      if (!["error", "warning"].includes(value)) {
        throw new Error("--fail-onにはerrorまたはwarningを指定してください");
      }
      failOn = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`不明なオプションです: ${argument}`);
    } else {
      files.push(argument);
    }
  }

  return { command, files, format, help, reviewMode, failOn, boldPolicy, output };
}

function printHelp() {
  process.stdout.write(`jp-docs-harness [check] [options] [files...]\n\nまず試す:\n  jp-docs-harness README.md\n  jp-docs-harness check docs/design.md\n\n主なコマンド:\n  check [files...]         文書を検査する（既定）\n  lint [files...]          checkの互換名\n  verify <file>            保存済み意味レビューの鮮度を確認する\n\n意味レビューの内部コマンド:\n  prepare <file>           review packetを生成する\n  snapshot <file>          URL根拠資料をローカルへ保存する\n  record <packet> <result> レビュー結果を検証して保存する\n\nJudge評価:\n  eval <gold> <candidate>  Judge結果を次元別に比較する\n  eval-prepare <dir>       同梱コーパスのreview packetを生成する\n  eval-suite <dir>         candidate一式をコーパスと比較する\n  eval-diff <base> <new>   二つのrun reportを次元別に比較する\n\nオプション:\n  --format <stylish|json>                  出力形式を指定する\n  --json                                   --format jsonの短縮形\n  --review-mode <manual|contracted|strict> 文書契約の適用方法を指定する\n  --bold <forbid|moderate|allow>           太字の扱いを指定する（既定は太字なし）\n  --fail-on <error|warning>                終了コード1にする重要度を指定する\n  --output <path>                          recordの保存先を指定する\n  -h, --help                               ヘルプを表示する\n\n既定では表現上の警告だけなら終了コード0、契約違反などのエラーがあれば終了コード1です。\nCIで警告も許さない場合は--fail-on warningを指定します。\n`);
}
