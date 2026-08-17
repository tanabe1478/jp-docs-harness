import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { splitSentences, stripCode, visibleText } from "../core/markdown-text.mjs";

// 読解負荷の検出器。AI臭さの検査（styleゲート・textlint preset）とは
// 目的が別で、判定やスコアは出さず「ここを見てください」と指すだけにする。
// 検出器を足してよいのは、読み流すと見落とすものだけ（網羅性が存在理由）。
// 見送った検出器とその理由はdocs/reading-load.mdに記録してある。
export const READING_LOAD_MODES = ["off", "check"];

// 読み手が実際に読む文字数での閾値。Markdown記法・URL・コードは数えない。
const SENTENCE_LENGTH_THRESHOLD = 100;

const DOUBLE_NEGATIVE = /なくはない|なくもない|ないわけではない|ないことはない|ないとは(?:言|い)えない|ないとも限らない/g;

// 名詞句を「の」で3回以上つないだ連鎖。チャンクを漢字・カタカナ・
// 英数字に限定し、「ではなく」のような機能語をまたぐ誤検知と、
// こそあど言葉の「の」を除く。ひらがなを含む名詞の連鎖は取りこぼすが、
// 誤検知を増やすより取りこぼす方を選ぶ。
const NO_CHAIN = /(?:[一-龠々ァ-ヶーA-Za-z0-9]{1,12}の){3,}/g;

export const readabilityGate = {
  id: "readability",
  async run({ cwd, documents, readingLoad }) {
    const findings = [];
    for (const document of documents) {
      const mode = document.contract?.style?.reading_load ?? readingLoad;
      if (mode !== "check") continue;
      const content = await readFile(path.join(cwd, document.path), "utf8");
      findings.push(...analyzeReadingLoad({ document: document.path, content }));
    }
    return { documents, findings };
  },
};

export function analyzeReadingLoad({ document, content }) {
  const findings = [];
  const lines = stripCode(content).split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    // 表の行は文ではないため対象外。
    if (/^\s*\|/.test(line)) return;

    const visible = visibleText(line);
    for (const sentence of splitSentences(visible)) {
      if (!sentence.terminated) continue;
      const length = sentence.end - sentence.start;
      if (length > SENTENCE_LENGTH_THRESHOLD) {
        findings.push(
          createReadabilityFinding({
            document,
            ruleId: "readability/sentence-too-long",
            message: `一文が${length}文字あります。読点で区切られた内容を複数の文へ分けられないか確認してください`,
            line: lineNumber,
          }),
        );
      }
    }

    for (const match of line.matchAll(DOUBLE_NEGATIVE)) {
      findings.push(
        createReadabilityFinding({
          document,
          ruleId: "readability/double-negative",
          message: `「${match[0]}」は二重否定です。肯定形で言い直せないか確認してください`,
          line: lineNumber,
          column: match.index + 1,
        }),
      );
    }

    for (const match of line.matchAll(NO_CHAIN)) {
      findings.push(
        createReadabilityFinding({
          document,
          ruleId: "readability/no-chain",
          message: `「${match[0]}」で「の」が3回以上連鎖しています。語順の入れ替えや動詞化で減らせないか確認してください`,
          line: lineNumber,
          column: match.index + 1,
        }),
      );
    }
  });

  return findings;
}

function createReadabilityFinding({ document, ruleId, message, line, column = 1 }) {
  const idSource = ["readability", document, ruleId, line, column, message].join("\0");
  return {
    id: `readability-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "readability",
    document,
    ruleId,
    severity: "info",
    verdict: "fail",
    resolution: "agent",
    message,
    location: { startLine: line, startColumn: column, endLine: line, endColumn: column },
    repairableByAgent: true,
  };
}
