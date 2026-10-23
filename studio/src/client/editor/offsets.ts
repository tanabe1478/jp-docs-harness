import type { EditorState } from "@codemirror/state";

// CodeMirror は改行を常に1文字として位置を数える。ファイルが CRLF のときは
// 文字列上のオフセット（UTF-16）と位置がずれるため、ここで相互に変換する。

export type LineSeparatorInfo = { separator: "\n" | "\r\n"; mixed: boolean };

export function detectLineSeparator(content: string): LineSeparatorInfo {
  const crlf = content.match(/\r\n/g)?.length ?? 0;
  const lf = (content.match(/\n/g)?.length ?? 0) - crlf;
  const cr = (content.match(/\r(?!\n)/g)?.length ?? 0);
  const mixed = [crlf, lf, cr].filter((count) => count > 0).length > 1;
  return { separator: crlf > lf ? "\r\n" : "\n", mixed };
}

// 混在した改行を一つに揃える。揃えた場合は保存時にファイルが変わる。
export function normalizeLineSeparators(content: string, separator: "\n" | "\r\n"): string {
  return content.replace(/\r\n|\r|\n/g, separator);
}

export function posToOffset(state: EditorState, pos: number): number {
  const extra = state.lineBreak.length - 1;
  if (extra === 0) return pos;
  const line = state.doc.lineAt(pos);
  return pos + (line.number - 1) * extra;
}

export function offsetToPos(state: EditorState, offset: number): number {
  const extra = state.lineBreak.length - 1;
  if (extra === 0) return Math.min(offset, state.doc.length);
  let low = 1;
  let high = state.doc.lines;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const lineStart = state.doc.line(middle).from + (middle - 1) * extra;
    if (lineStart <= offset) low = middle;
    else high = middle - 1;
  }
  const line = state.doc.line(low);
  const pos = offset - (low - 1) * extra;
  return Math.min(pos, line.to);
}

export function editorContent(state: EditorState): string {
  return state.sliceDoc();
}

// 字数は空白と改行を除いた文字（コードポイント）で数える。
export function countCharacters(content: string): number {
  let count = 0;
  for (const character of content) if (!/\s/u.test(character)) count += 1;
  return count;
}
