#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import * as textlint from "textlint";
import * as yaml from "yaml";
import { runHarness } from "../lib/run-harness.mjs";
import { prepareReviewPackets } from "../lib/semantic/prepare-review.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = path.resolve(process.cwd());
const configFilePath = path.join(packageRoot, ".textlintrc.json");
const intentSchemaPath = path.join(packageRoot, "schemas", "intent.schema.json");

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

  const result = await runHarness({
    textlint,
    yaml,
    Ajv,
    cwd,
    files: options.files,
    reviewMode: options.reviewMode,
    configFilePath,
    nodeModulesDir: path.join(packageRoot, "node_modules"),
    intentSchemaPath,
  });

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  } else if (result.humanOutput) {
    process.stdout.write(`${result.humanOutput}\n`);
  }
  process.exit(result.hasFindings ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

function parseArguments(args) {
  const knownCommands = new Set(["lint", "prepare"]);
  const hasCommand = knownCommands.has(args[0]);
  const command = hasCommand ? args[0] : "lint";
  const remaining = hasCommand ? args.slice(1) : [...args];
  const files = [];
  let format = "stylish";
  let help = false;
  let reviewMode = "manual";

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
    } else if (argument === "--review-mode") {
      const value = remaining[index + 1];
      if (!["manual", "contracted", "strict"].includes(value)) {
        throw new Error("--review-modeにはmanual、contracted、strictのいずれかを指定してください");
      }
      reviewMode = value;
      index += 1;
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`不明なオプションです: ${argument}`);
    } else {
      files.push(argument);
    }
  }

  return { command, files, format, help, reviewMode };
}

function printHelp() {
  process.stdout.write(`jp-docs-harness <command> [options] [files...]\n\nCommands:\n  lint [files...]          決定論的な検査を実行する\n  prepare <file>           意味レビュー用のreview packetを生成する\n\nOptions for lint:\n  --format <stylish|json>                 出力形式を指定する\n  --json                                  --format jsonの短縮形\n  --review-mode <manual|contracted|strict> 文書契約の適用方法を指定する\n  -h, --help                              ヘルプを表示する\n`);
}
