import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import Ajv from "ajv/dist/2020.js";
import * as textlint from "textlint";
import * as yaml from "yaml";
import { resolveDocumentScope } from "../lib/core/document-scope.mjs";
import { runHarness } from "../lib/run-harness.mjs";

const MAX_FEEDBACK_LENGTH = 10_000;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type ScopePromptContext = {
	cwd: string;
	ui: {
		input(title: string, placeholder?: string): Promise<string | undefined>;
	};
};

export default function textlintOnSettle(pi: ExtensionAPI) {
	pi.registerCommand("check-docs", {
		description: "Gitリポジトリまたは日本語Markdownを検査する",
		handler: async (args, ctx) => {
			try {
				const scope = await resolveCheckScope(ctx, args.trim());
				if (!scope) return;
				const result = await lintProject(scope.cwd, scope.files);
				if (!result.hasFindings) {
					ctx.ui.notify(result.humanOutput, "info");
					return;
				}
				pi.sendUserMessage(formatFeedback(result.humanOutput));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});

	pi.registerCommand("lint-docs", {
		description: "check-docsの互換名",
		handler: async (args, ctx) => {
			try {
				const scope = await resolveCheckScope(ctx, args.trim());
				if (!scope) return;
				const result = await lintProject(scope.cwd, scope.files);
				if (!result.hasFindings) {
					ctx.ui.notify(result.humanOutput, "info");
					return;
				}
				pi.sendUserMessage(formatFeedback(result.humanOutput));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
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
			try {
				let target = args.trim();
				if (!target) {
					target = (await ctx.ui.input("レビュー対象", "Markdownファイルのパス"))?.trim() ?? "";
				}
				if (!target) return;
				const scope = resolveDocumentScope({ projectDir: ctx.cwd, target });
				if (scope.files.length !== 1) {
					ctx.ui.notify("意味レビューにはMarkdownファイルを一件指定してください", "warning");
					return;
				}
				const cli = path.join(packageRoot, "bin", "jp-docs-harness.mjs");
				pi.sendUserMessage(reviewInstructions(scope.files[0], cli, scope.cwd));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}

async function resolveCheckScope(ctx: ScopePromptContext, target: string) {
	if (target) return resolveDocumentScope({ projectDir: ctx.cwd, target });
	try {
		return resolveDocumentScope({ projectDir: ctx.cwd });
	} catch {
		const selected = (await ctx.ui.input(
			"検査対象",
			"GitリポジトリまたはMarkdownファイルのパス",
		))?.trim();
		return selected ? resolveDocumentScope({ projectDir: ctx.cwd, target: selected }) : null;
	}
}

async function lintProject(cwd: string, files: string[]) {
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

function reviewInstructions(target: string, cli: string, repositoryRoot: string): string {
	const resultSchema = path.resolve(path.dirname(cli), "..", "schemas", "review-result.schema.json");
	const root = JSON.stringify(repositoryRoot);
	return `${target}を意味レビューしてください。作業ディレクトリは${repositoryRoot}です。

最初に対象本文を読み、文書契約${target}.intent.ymlが存在するか確認してください。契約がなければ、本文と現在の利用者の依頼から、想定読者、読後に得てほしい理解・判断・行動、欠かせない内容を抽出し、最小の文書契約を作成してください。目的を合理的に特定できる場合は確認を挟まず進め、結果の冒頭で採用した前提を短く示してください。目的によって評価が大きく変わる場合だけ、利用者へ一つの簡潔な質問をしてください。書き手の経験や動機を推測してauthor_onlyへ追加してはいけません。契約を作成した場合は、そのパスと下書きであることを報告してください。

契約を用意した後は、次の手順を守ってください。

1. \`cd ${root} && mkdir -p .jp-docs-harness/work\`を実行する
2. \`cd ${root} && node ${JSON.stringify(cli)} prepare ${JSON.stringify(target)} > .jp-docs-harness/work/review-packet.json\`を実行する
3. 必須のURL資料にsnapshotがなければ、ネットワーク取得前に利用者へ許可を求める。許可された場合だけ\`cd ${root} && node ${JSON.stringify(cli)} snapshot ${JSON.stringify(target)}\`を実行してpacketを再生成する
4. review packetだけを根拠として、すべてのchecks、authorOnly、本文中の検証可能な主張を独立して判定する
5. 主張は原文と行番号を記録し、status: loadedの資料だけを行番号付きで引用する。sourcePolicy: requiredの判定はclaimIdsから全sourceIdsの引用へ接続する。書き手固有の経験に根拠がなければneeds_authorにする
6. ${resultSchema}の形式で${repositoryRoot}/.jp-docs-harness/work/review-result.jsonへ保存する。rubricHashとevidenceHashはpacketからコピーし、promptVersionは2にする
7. \`cd ${root} && node ${JSON.stringify(cli)} record .jp-docs-harness/work/review-packet.json .jp-docs-harness/work/review-result.json\`を実行する
8. \`cd ${root} && node ${JSON.stringify(cli)} verify ${JSON.stringify(target)}\`を実行する

missing、contradicts、partially_meetsには本文の根拠行と理由を付けてください。needs_authorを推測で解決しないでください。agentが修正可能な指摘だけを一度修正できます。修正した場合はreview packetの生成から記録までを一度だけやり直し、問題が残れば利用者へ返してください。`;
}

function formatFeedback(output: string): string {
	const header = "Markdownの検査結果です。AIで安全に修正できる指摘だけを直し、書き手の入力が必要なものは質問してください。\n\n";
	const available = MAX_FEEDBACK_LENGTH - header.length;
	if (output.length <= available) return header + output;

	return `${header}${output.slice(0, available)}\n\n出力を省略しました。/check-docsで残りを確認してください。`;
}
