import {
  recordClaudeTouchedFile,
  resetClaudeTouchedFiles,
} from "../lib/integrations/claude-session-files.mjs";

const event = await readEvent();
const pluginData = process.env.CLAUDE_PLUGIN_DATA;

if (!pluginData) process.exit(0);

try {
  if (process.argv.includes("--reset")) {
    await resetClaudeTouchedFiles({ pluginData, event });
  } else {
    await recordClaudeTouchedFile({ pluginData, event });
  }
} catch (error) {
  process.stderr.write(
    `jp-docs-harness: Markdown変更の記録に失敗しました: ${error instanceof Error ? error.message : String(error)}\n`,
  );
}

async function readEvent() {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}
