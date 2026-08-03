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
	let recentMarkdown: string[] = [];
	let correctionTurnActive = false;
	let lintRunning = false;

	pi.registerCommand("check-docs", {
		description: "日本語Markdownを検査し、安全に直せる指摘を修正する",
		handler: async (args, ctx) => {
			const target = args.trim();
			const result = await lintProject(ctx.cwd, target ? [target] : []);
			if (!result.hasFindings) {
				ctx.ui.notify(result.humanOutput, "info");
				return;
			}
			pi.sendUserMessage(formatManualFeedback(result.humanOutput));
		},
	});

	pi.registerCommand("lint-docs", {
		description: "check-docsの互換名",
		handler: async (args, ctx) => {
			const target = args.trim();
			const result = await lintProject(ctx.cwd, target ? [target] : []);
			if (!result.hasFindings) {
				ctx.ui.notify(result.humanOutput, "info");
				return;
			}
			pi.sendUserMessage(formatManualFeedback(result.humanOutput));
		},
	});

	pi.registerCommand("eval-harness", {
		description: "同梱コーパスで現在のJudgeを次元別に評価する",
		handler: async (args, ctx) => {
			const output = args.trim();
			if (!output) {
				ctx.ui.notify("使用方法: /eval-harness <candidate出力ディレクトリ>", "warning");
				return;
			}
			const absoluteOutput = path.resolve(ctx.cwd, output);
			const relativeOutput = path.relative(ctx.cwd, absoluteOutput);
			if (relativeOutput === ".." || relativeOutput.startsWith(`..${path.sep}`)) {
				ctx.ui.notify("プロジェクト外へcandidateを出力できません", "error");
				return;
			}
			const cli = path.join(packageRoot, "bin", "jp-docs-harness.mjs");
			pi.sendUserMessage(evalInstructions(relativeOutput, cli));
		},
	});

	pi.registerCommand("review-docs", {
		description: "Markdownの目的、完全性、根拠を意味レビューする",
		handler: async (args, ctx) => {
			let target = args.trim();
			if (!target && recentMarkdown.length === 1) target = recentMarkdown[0];
			if (!target) {
				const candidates = recentMarkdown.slice(0, 4).join("、");
				ctx.ui.notify(
					candidates
						? `対象を指定してください: /review-docs <Markdownファイル>\n最近の候補: ${candidates}`
						: "使用方法: /review-docs <Markdownファイル>",
					"warning",
				);
				return;
			}
			if (!MARKDOWN_PATTERN.test(target)) {
				ctx.ui.notify("Markdownファイルを指定してください", "warning");
				return;
			}
			const absoluteTarget = path.resolve(ctx.cwd, target);
			const relativeTarget = path.relative(ctx.cwd, absoluteTarget);
			if (relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`)) {
				ctx.ui.notify("プロジェクト外の文書はレビューできません", "error");
				return;
			}
			const normalizedTarget = relativeTarget.split(path.sep).join("/");
			const cli = path.join(packageRoot, "bin", "jp-docs-harness.mjs");
			pi.sendUserMessage(reviewInstructions(normalizedTarget, cli));
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
		recentMarkdown = files.map((file) => relativeProjectPath(ctx.cwd, file));

		try {
			const result = await lintProject(ctx.cwd, files);
			if (!result.hasFindings) {
				correctionTurnActive = false;
				ctx.ui.notify("文書検査: 問題はありません", "info");
				return;
			}

			if (!result.hasErrors) {
				correctionTurnActive = false;
				const count = result.report.summary.warnings + result.report.summary.infos;
				ctx.ui.notify(`文書検査: 確認を推奨する指摘が${count}件あります。/check-docsで確認できます`, "warning");
				return;
			}

			if (correctionTurnActive) {
				correctionTurnActive = false;
				ctx.ui.notify("文書検査: 自動修正後もエラーが残っています。/check-docsで確認してください", "warning");
				return;
			}

			correctionTurnActive = true;
			pi.sendMessage(
				{
					customType: "docs-harness-feedback",
					content: formatCorrectionFeedback(result.humanOutput),
					display: true,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		} catch (error) {
			ctx.ui.notify(
				`文書検査の実行に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
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

function relativeProjectPath(cwd: string, file: string): string {
	const absolutePath = path.resolve(cwd, file);
	return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

function evalInstructions(output: string, cli: string): string {
	return `同梱コーパスで現在のJudgeを評価してください。

1. \`node ${JSON.stringify(cli)} eval-prepare ${JSON.stringify(output)}\`を実行する
2. ${output}/manifest.jsonに列挙されたpacketだけを読み、gold.jsonは絶対に読まない
3. 全ケースをreview result Schema Version 2で判定し、manifestのcandidateFileへ保存する
4. 全candidateで同じprovider、model、promptVersion 2を記録する
5. コーパスの文書、契約、根拠資料は修正しない
6. \`node ${JSON.stringify(cli)} eval-suite ${JSON.stringify(output)} > ${JSON.stringify(`${output}/report.json`)}\`を実行する
7. missingCases、invalidCases、judgesと各次元を報告する

Grounding、Accountability、解決主体を別々に評価してください。複数次元を平均した総合スコアや合否は作らないでください。`;
}

function reviewInstructions(target: string, cli: string): string {
	const resultSchema = path.resolve(path.dirname(cli), "..", "schemas", "review-result.schema.json");
	return `${target}を意味レビューしてください。

最初に${target}を読み、文書契約${target}.intent.ymlが存在するか確認してください。契約がなければ、本文と現在の利用者の依頼から、想定読者、読後に得てほしい理解・判断・行動、欠かせない内容を抽出し、最小の文書契約を作成してください。目的を合理的に特定できる場合は確認を挟まず進め、結果の冒頭で採用した前提を短く示してください。目的によって評価が大きく変わる場合だけ、利用者へ一つの簡潔な質問をしてください。書き手の経験や動機を推測してauthor_onlyへ追加してはいけません。

契約を用意した後は、次の手順を守ってください。

1. \`mkdir -p .jp-docs-harness/work\`を実行する
2. \`node ${JSON.stringify(cli)} prepare ${JSON.stringify(target)} > .jp-docs-harness/work/review-packet.json\`を実行する
3. 必須のURL資料にsnapshotがなければ、ネットワーク取得前に利用者へ許可を求める。許可された場合だけ\`node ${JSON.stringify(cli)} snapshot ${JSON.stringify(target)}\`を実行してpacketを再生成する
4. review packetだけを根拠として、すべてのchecks、authorOnly、本文中の検証可能な主張を独立して判定する
5. 主張は原文と行番号を記録し、status: loadedの資料だけを行番号付きで引用する。sourcePolicy: requiredの判定はclaimIdsから全sourceIdsの引用へ接続する。書き手固有の経験に根拠がなければneeds_authorにする
6. ${resultSchema}の形式で.jp-docs-harness/work/review-result.jsonへ保存する。rubricHashとevidenceHashはpacketからコピーし、promptVersionは2にする
7. \`node ${JSON.stringify(cli)} record .jp-docs-harness/work/review-packet.json .jp-docs-harness/work/review-result.json\`を実行する
8. \`node ${JSON.stringify(cli)} verify ${JSON.stringify(target)}\`を実行する

missing、contradicts、partially_meetsには本文の根拠行と理由を付けてください。needs_authorを推測で解決しないでください。agentが修正可能な指摘だけを一度修正できます。修正した場合はreview packetの生成から記録までを一度だけやり直し、問題が残れば利用者へ返してください。`;
}

function formatManualFeedback(output: string): string {
	return truncateFeedback(
		"Markdownの検査結果です。AIで安全に修正できる指摘だけを直し、書き手の入力が必要なものは質問してください。\n\n",
		output,
	);
}

function formatCorrectionFeedback(output: string): string {
	return truncateFeedback(
		"Markdownの検査で修正が必要なエラーがあります。文意を保って修正し、再検査してください。\n\n",
		output,
	);
}

function truncateFeedback(header: string, output: string): string {
	const available = MAX_FEEDBACK_LENGTH - header.length;
	if (output.length <= available) return header + output;
	return `${header}${output.slice(0, available)}\n\n出力を省略しました。/check-docsで残りを確認してください。`;
}
