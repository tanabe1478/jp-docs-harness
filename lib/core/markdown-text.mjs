// Markdown本文をテキスト検査向けに整形する共通処理。
// natural-japanese v1.4.0で、記法のマーカーを本文として数えたことが
// 指摘の42%を占める誤検知になった事例があるため、検査の前に取り除く。

// コードブロックとインラインコードを検査対象から外す。
// 行番号を保つため、フェンス内は空行へ、インラインコードは同じ長さの
// 空白へ置き換える（位置を使う検出器のため）。
export function stripCode(content) {
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

// 読み手が実際に読む文字だけを残す。文の長さを測る用途向けで、
// インラインコード・画像・URL・強調マーカーは長さに数えない。
export function visibleText(line) {
  return line
    .replace(/`[^`\n]*`/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_~]/g, "")
    .replace(/^\s*(?:[-+*]|\d+\.|#+|>)\s+/, "")
    .trim();
}

const SENTENCE_END = /[。！？]/;

export function splitSentences(line) {
  const sentences = [];
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (SENTENCE_END.test(line[index])) {
      sentences.push({ start, end: index + 1, terminated: true });
      start = index + 1;
    }
  }
  if (start < line.length) sentences.push({ start, end: line.length, terminated: false });
  return sentences;
}
