import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { prepareReviewPackets } from "../lib/semantic/prepare-review.mjs";
import {
  inspectStoredReview,
  loadJsonFile,
  recordReviewResult,
} from "../lib/semantic/review-result.mjs";

const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
const pluginData = process.env.CLAUDE_PLUGIN_DATA;
const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

if (!pluginRoot || !pluginData) fail("Claude Code Pluginの環境変数がありません");

try {
  const [command, ...args] = process.argv.slice(2);
  const requireFromData = createRequire(path.join(pluginData, "package.json"));
  const yamlPath = requireFromData.resolve("yaml");
  const ajvPath = requireFromData.resolve("ajv/dist/2020.js");
  const yaml = await import(pathToFileURL(yamlPath).href);
  const { default: Ajv } = await import(pathToFileURL(ajvPath).href);
  const intentSchemaPath = path.join(pluginRoot, "schemas", "intent.schema.json");
  const reviewPacketSchemaPath = path.join(pluginRoot, "schemas", "review-packet.schema.json");
  const reviewResultSchemaPath = path.join(pluginRoot, "schemas", "review-result.schema.json");

  if (command === "prepare") {
    if (args.length !== 1) fail("prepareにはMarkdownファイルを1件指定してください");
    const [packet] = await prepareReviewPackets({ cwd, files: args, yaml, Ajv, intentSchemaPath });
    process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
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
