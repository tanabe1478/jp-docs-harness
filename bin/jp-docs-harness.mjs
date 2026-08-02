#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as textlint from "textlint";
import { runTextlint } from "../lib/run-textlint.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cwd = path.resolve(process.cwd());

try {
  const result = await runTextlint({
    textlint,
    cwd,
    configFilePath: path.join(packageRoot, ".textlintrc.json"),
    nodeModulesDir: path.join(packageRoot, "node_modules"),
  });

  if (result.output) process.stdout.write(`${result.output}\n`);
  process.exit(result.hasMessages ? 1 : 0);
} catch (error) {
  process.stderr.write(`jp-docs-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}
