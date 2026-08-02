#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as textlint from "textlint";
import { runHarness } from "../lib/run-harness.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = path.resolve(process.cwd());

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const result = await runHarness({
    textlint,
    cwd,
    files: options.files,
    configFilePath: path.join(packageRoot, ".textlintrc.json"),
    nodeModulesDir: path.join(packageRoot, "node_modules"),
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
  const remaining = args[0] === "lint" ? args.slice(1) : [...args];
  const files = [];
  let format = "stylish";
  let help = false;

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
    } else if (argument === "--help" || argument === "-h") {
      help = true;
    } else if (argument.startsWith("-")) {
      throw new Error(`不明なオプションです: ${argument}`);
    } else {
      files.push(argument);
    }
  }

  return { files, format, help };
}

function printHelp() {
  process.stdout.write(`jp-docs-harness [lint] [options] [files...]\n\nOptions:\n  --format <stylish|json>  出力形式を指定する\n  --json                   --format jsonの短縮形\n  -h, --help               ヘルプを表示する\n`);
}
