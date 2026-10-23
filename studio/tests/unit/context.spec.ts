import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_CONTEXT_CHARS, SELECTION_MARKER, extractSurroundingContext } from "../../src/server/services/context.ts";

describe("AIへ送る文脈", () => {
  it("選択を含む段落の前後1段落までに限る", () => {
    const text = "一段落目。\n\n二段落目。\n\n三段落目の中の選択。\n\n四段落目。\n\n五段落目。";
    const start = text.indexOf("選択");
    const context = extractSurroundingContext(text, start, start + 2);
    assert.equal(context, `二段落目。\n\n三段落目の中の${SELECTION_MARKER}。\n\n四段落目。`);
  });

  it("前後それぞれ上限の半分で切り、選択に近い側を残す", () => {
    const longBefore = `${"前".repeat(5000)}近い前`;
    const longAfter = `近い後${"後".repeat(5000)}`;
    const text = `${longBefore}選択${longAfter}`;
    const start = longBefore.length;
    const context = extractSurroundingContext(text, start, start + 2);
    assert.ok(context.length <= MAX_CONTEXT_CHARS + SELECTION_MARKER.length);
    assert.ok(context.startsWith("前"));
    assert.ok(context.includes(`近い前${SELECTION_MARKER}近い後`));
  });

  it("先頭や末尾の段落を選んでも範囲外を参照しない", () => {
    const text = "先頭。\n\n次。";
    assert.equal(extractSurroundingContext(text, 0, 3), `${SELECTION_MARKER}\n\n次。`);
    const start = text.indexOf("次");
    assert.equal(extractSurroundingContext(text, start, start + 2), `先頭。\n\n${SELECTION_MARKER}`);
  });

  it("CRLF の空行も段落の区切りとして扱う", () => {
    const text = "一。\r\n\r\n二。\r\n\r\n三。\r\n\r\n四。";
    const start = text.indexOf("三");
    assert.equal(extractSurroundingContext(text, start, start + 2), `二。\r\n\r\n${SELECTION_MARKER}\r\n\r\n四。`);
  });
});
