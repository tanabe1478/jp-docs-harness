import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as textlint from "textlint";
import { runTextlint } from "../lib/run-textlint.mjs";

const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;
const MAX_FEEDBACK_LENGTH = 10_000;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default function textlintOnSettle(pi: ExtensionAPI) {
	let markdownTouched = false;
	let correctionTurnActive = false;
	let lintRunning = false;

	pi.registerCommand("lint-docs", {
		description: "日本語のMarkdown文書をtextlintで検査し、指摘を修正する",
		handler: async (_args, ctx) => {
			const result = await lintProject(ctx.cwd);
			if (!result.hasMessages) {
				ctx.ui.notify("textlint: 指摘はありません", "info");
				return;
			}
			pi.sendUserMessage(formatFeedback(result.output));
		},
	});

	pi.on("tool_call", (event) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;

		const input = event.input as { path?: unknown };
		if (typeof input.path === "string" && MARKDOWN_PATTERN.test(input.path)) {
			markdownTouched = true;
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!markdownTouched || lintRunning) return;

		lintRunning = true;
		markdownTouched = false;

		try {
			const result = await lintProject(ctx.cwd);
			if (!result.hasMessages) {
				correctionTurnActive = false;
				ctx.ui.notify("textlint: 指摘はありません", "info");
				return;
			}

			if (correctionTurnActive) {
				correctionTurnActive = false;
				ctx.ui.notify("textlint: 指摘が残っています。/lint-docs で確認してください", "warning");
				return;
			}

			correctionTurnActive = true;
			pi.sendMessage(
				{
					customType: "textlint-feedback",
					content: formatFeedback(result.output),
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} catch (error) {
			ctx.ui.notify(
				`textlintの実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		} finally {
			lintRunning = false;
		}
	});
}

async function lintProject(cwd: string) {
	return runTextlint({
		textlint,
		cwd,
		configFilePath: path.join(packageRoot, ".textlintrc.json"),
		nodeModulesDir: path.join(packageRoot, "node_modules"),
	});
}

function formatFeedback(output: string): string {
	const header = "Markdownにtextlintの指摘があります。文意を保って修正し、再検査してください。\n\n";
	const available = MAX_FEEDBACK_LENGTH - header.length;
	if (output.length <= available) return header + output;

	return `${header}${output.slice(0, available)}\n\n出力を省略しました。/lint-docsで残りを確認してください。`;
}
