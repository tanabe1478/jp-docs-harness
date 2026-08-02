import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Ajv from "ajv/dist/2020.js";
import * as textlint from "textlint";
import * as yaml from "yaml";
import { runHarness } from "../lib/run-harness.mjs";

const MARKDOWN_PATTERN = /\.(?:md|markdown)$/i;
const MAX_FEEDBACK_LENGTH = 10_000;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export default function textlintOnSettle(pi: ExtensionAPI) {
	const touchedMarkdown = new Set<string>();
	let correctionTurnActive = false;
	let lintRunning = false;

	pi.registerCommand("lint-docs", {
		description: "日本語のMarkdown文書をtextlintで検査し、指摘を修正する",
		handler: async (_args, ctx) => {
			const result = await lintProject(ctx.cwd);
			if (!result.hasFindings) {
				ctx.ui.notify("textlint: 指摘はありません", "info");
				return;
			}
			pi.sendUserMessage(formatFeedback(result.humanOutput));
		},
	});

	pi.registerCommand("review-docs", {
		description: "文書契約に基づいてMarkdownの完全性と根拠を検査する",
		handler: async (args, ctx) => {
			const target = args.trim();
			if (!target || !MARKDOWN_PATTERN.test(target)) {
				ctx.ui.notify("使用方法: /review-docs <Markdownファイル>", "warning");
				return;
			}
			const absoluteTarget = path.resolve(ctx.cwd, target);
			const relativeTarget = path.relative(ctx.cwd, absoluteTarget);
			if (relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`)) {
				ctx.ui.notify("プロジェクト外の文書はレビューできません", "error");
				return;
			}
			const cli = path.join(packageRoot, "bin", "jp-docs-harness.mjs");
			pi.sendUserMessage(reviewInstructions(relativeTarget, cli));
		},
	});

	pi.on("tool_call", (event) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;

		const input = event.input as { path?: unknown };
		if (typeof input.path === "string" && MARKDOWN_PATTERN.test(input.path)) {
			touchedMarkdown.add(input.path);
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (touchedMarkdown.size === 0 || lintRunning) return;

		lintRunning = true;
		const files = [...touchedMarkdown];
		touchedMarkdown.clear();

		try {
			const result = await lintProject(ctx.cwd, files);
			if (!result.hasFindings) {
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
					content: formatFeedback(result.humanOutput),
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

async function lintProject(cwd: string, files: string[] = []) {
	return runHarness({
		textlint,
		yaml,
		Ajv,
		cwd,
		files,
		configFilePath: path.join(packageRoot, ".textlintrc.json"),
		nodeModulesDir: path.join(packageRoot, "node_modules"),
	});
}

function reviewInstructions(target: string, cli: string): string {
	const resultSchema = path.resolve(path.dirname(cli), "..", "schemas", "review-result.schema.json");
	return `文書契約に基づいて ${target} を意味レビューしてください。

次の手順を守ってください。

1. \`mkdir -p .jp-docs-harness/work\`を実行する
2. \`node ${JSON.stringify(cli)} prepare ${JSON.stringify(target)} > .jp-docs-harness/work/review-packet.json\`を実行する
3. review packetだけを根拠として、すべてのchecks、authorOnly、本文中の検証可能な主張を独立して判定する
4. 主張は原文と行番号を記録し、status: loadedの資料だけを行番号付きで引用する。sourcePolicy: requiredの判定はclaimIdsから全sourceIdsの引用へ接続する。書き手固有の経験に根拠がなければneeds_authorにする
5. ${resultSchema}の形式で.jp-docs-harness/work/review-result.jsonへ保存する。rubricHashとevidenceHashはpacketからコピーし、promptVersionは2にする
6. \`node ${JSON.stringify(cli)} record .jp-docs-harness/work/review-packet.json .jp-docs-harness/work/review-result.json\`を実行する
7. \`node ${JSON.stringify(cli)} verify ${JSON.stringify(target)}\`を実行する

missing、contradicts、partially_meetsには本文の根拠行と理由を付けてください。needs_authorを推測で解決しないでください。agentが修正可能な指摘だけを一度修正できます。修正した場合はreview packetの生成から記録までを一度だけやり直し、問題が残れば利用者へ返してください。`;
}

function formatFeedback(output: string): string {
	const header = "Markdownにtextlintの指摘があります。文意を保って修正し、再検査してください。\n\n";
	const available = MAX_FEEDBACK_LENGTH - header.length;
	if (output.length <= available) return header + output;

	return `${header}${output.slice(0, available)}\n\n出力を省略しました。/lint-docsで残りを確認してください。`;
}
