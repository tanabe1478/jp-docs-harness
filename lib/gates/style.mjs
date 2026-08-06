import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

// 太字の密度警告を出す文書あたりの太字スパン数。
const BOLD_DENSITY_THRESHOLD = 6;

// 文末に付け足されがちな、書き手の評価・感想・教訓の定型表現。
// 事実を述べれば読み手が判断できる場面で使われやすい。
const EDITORIAL_PATTERNS = [
  /という(?:教訓|学び)/g,
  /注意が必要/g,
  /注意したい/g,
  /押さえておきたい/g,
  /意識したい/g,
  /興味深いことに/g,
  /特筆すべきは/g,
  /厄介/g,
];

const BOLD_SPAN = /\*\*([^*\n]+?)\*\*/g;
const SENTENCE_END = /[。！？]/;

export const styleGate = {
  id: "style",
  async run({ cwd, documents }) {
    const findings = [];
    for (const document of documents) {
      const content = await readFile(path.join(cwd, document.path), "utf8");
      findings.push(...analyzeDocumentStyle({ document: document.path, content }));
    }
    return { documents, findings };
  },
};

export function analyzeDocumentStyle({ document, content }) {
  const findings = [];
  const lines = stripCode(content).split("\n");
  let boldSpanCount = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const spans = [...line.matchAll(BOLD_SPAN)];
    boldSpanCount += spans.length;

    for (const span of spans) {
      if (SENTENCE_END.test(span[1].trim().slice(-1))) {
        findings.push(
          createStyleFinding({
            document,
            ruleId: "style/bold-sentence",
            message:
              "文全体が太字になっています。文の中で本当に強調したい語だけへ絞るか、強調を外してください",
            line: lineNumber,
            column: span.index + 1,
          }),
        );
      }
    }

    for (const sentence of splitSentences(line)) {
      const sentenceSpans = spans.filter(
        (span) => span.index >= sentence.start && span.index < sentence.end,
      );
      if (sentenceSpans.length >= 2) {
        findings.push(
          createStyleFinding({
            document,
            ruleId: "style/bold-in-sentence",
            message: `1文に太字が${sentenceSpans.length}箇所あります。強調が競合して重要度が読み取れなくなるため、最も重要な1箇所へ絞ってください`,
            line: lineNumber,
            column: sentenceSpans[0].index + 1,
          }),
        );
      }
    }

    for (const pattern of EDITORIAL_PATTERNS) {
      for (const match of line.matchAll(pattern)) {
        findings.push(
          createStyleFinding({
            document,
            ruleId: "style/editorializing",
            message: `「${match[0]}」は書き手の評価・感想の可能性があります。事実から読み手が判断できる場合は削除を検討してください`,
            line: lineNumber,
            column: match.index + 1,
          }),
        );
      }
    }
  });

  if (boldSpanCount >= BOLD_DENSITY_THRESHOLD) {
    findings.push(
      createStyleFinding({
        document,
        ruleId: "style/bold-density",
        message: `太字が${boldSpanCount}箇所あります。強調が文書全体に散ると、どこが重要か判別できなくなります。本当に重要な数箇所へ絞ってください`,
        line: null,
        column: null,
      }),
    );
  }

  return findings;
}

// コードブロックとインラインコードを検査対象から外す。
// 行番号を保つため、フェンス内は空行へ置き換える。
function stripCode(content) {
  const lines = content.split("\n");
  let inFence = false;
  const result = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return "";
    }
    if (inFence) return "";
    return line.replace(/`[^`\n]*`/g, (code) => " ".repeat(code.length));
  });
  return result.join("\n");
}

function splitSentences(line) {
  const sentences = [];
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (SENTENCE_END.test(line[index])) {
      sentences.push({ start, end: index + 1 });
      start = index + 1;
    }
  }
  if (start < line.length) sentences.push({ start, end: line.length });
  return sentences;
}

function createStyleFinding({ document, ruleId, message, line, column }) {
  const idSource = ["style", document, ruleId, line ?? 0, column ?? 0, message].join("\0");
  return {
    id: `style-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "style",
    document,
    ruleId,
    severity: "warning",
    verdict: "fail",
    resolution: "agent",
    message,
    location: line === null ? null : { startLine: line, startColumn: column, endLine: line, endColumn: column },
    repairableByAgent: true,
  };
}
