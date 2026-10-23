import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { describe, it } from "node:test";
import {
  countCharacters,
  detectLineSeparator,
  editorContent,
  normalizeLineSeparators,
  offsetToPos,
  posToOffset,
} from "../../src/client/editor/offsets.ts";

function stateFor(content: string) {
  const { separator } = detectLineSeparator(content);
  return EditorState.create({
    doc: content,
    extensions: separator === "\r\n" ? EditorState.lineSeparator.of("\r\n") : [],
  });
}

describe("エディタの位置と文字列オフセット", () => {
  it("LF の原稿では位置とオフセットが一致し、内容もそのまま戻る", () => {
    const content = "一行目😀\n\n三行目";
    const state = stateFor(content);
    assert.equal(editorContent(state), content);
    const pos = content.indexOf("三");
    assert.equal(posToOffset(state, pos), pos);
    assert.equal(offsetToPos(state, pos), pos);
  });

  it("CRLF の原稿では改行1つにつき1ずれる分を補正し、内容は CRLF のまま戻る", () => {
    const content = "一行目😀\r\n\r\n三行目の文";
    const state = stateFor(content);
    assert.equal(editorContent(state), content);
    const offset = content.indexOf("文");
    const pos = state.doc.toString().indexOf("文");
    assert.equal(posToOffset(state, pos), offset);
    assert.equal(offsetToPos(state, offset), pos);
    assert.equal(state.sliceDoc(pos, pos + 1), content.slice(offset, offset + 1));
  });

  it("改行コードの混在を検出し、多い方へ揃える", () => {
    const info = detectLineSeparator("a\r\nb\r\nc\nd");
    assert.deepEqual(info, { separator: "\r\n", mixed: true });
    assert.equal(normalizeLineSeparators("a\r\nb\nc\rd", "\n"), "a\nb\nc\nd");
    assert.deepEqual(detectLineSeparator("a\nb"), { separator: "\n", mixed: false });
  });

  it("字数は空白と改行を除き、絵文字を1字と数える", () => {
    assert.equal(countCharacters("私は 😀\n考える。"), 7);
  });
});
