export const MAX_CONTEXT_CHARS = 4000;
export const SELECTION_MARKER = "［選択箇所］";

// 選択箇所の前後から、AIへ送る限られた文脈を切り出す。
// 範囲は「選択を含む段落の一つ前の段落の先頭」から「一つ後の段落の末尾」まで。
// 前後それぞれ上限の半分で切り、選択箇所に近い側を残す。
export function extractSurroundingContext(content: string, start: number, end: number): string {
  const blocks = paragraphBoundaries(content);
  const first = blocks.findIndex((block) => block.end >= start);
  let last = -1;
  blocks.forEach((block, index) => {
    if (block.start <= end) last = index;
  });

  const windowStart = first > 0 ? (blocks[first - 1]?.start ?? 0) : first === 0 ? 0 : (blocks.at(-1)?.start ?? 0);
  const windowEnd = last >= 0 ? (blocks[last + 1]?.end ?? content.length) : (blocks[0]?.end ?? content.length);

  const half = MAX_CONTEXT_CHARS / 2;
  const before = content.slice(Math.min(windowStart, start), start).slice(-half);
  const after = content.slice(end, Math.max(windowEnd, end)).slice(0, half);
  return `${before}${SELECTION_MARKER}${after}`;
}

// 空行で区切られた段落の範囲を返す。
export function paragraphBoundaries(content: string): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  const separator = /\r?\n(?:[ \t]*\r?\n)+/g;
  let cursor = 0;
  for (const match of content.matchAll(separator)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ start: cursor, end: index });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) blocks.push({ start: cursor, end: content.length });
  return blocks;
}
