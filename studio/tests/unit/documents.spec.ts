import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { StudioError } from "../../src/server/errors.ts";
import { hashContent } from "../../src/server/hash.ts";
import { createDocumentService } from "../../src/server/services/documents.ts";
import { makeTempDirs, writeFile } from "../fixtures/temp.ts";

describe("原稿の読み書き", () => {
  it("A-01: 日本語と絵文字を含む原稿を作成・保存し、再度読むと完全に一致する", async () => {
    const { workspace } = await makeTempDirs();
    const documents = createDocumentService(workspace);
    const created = await documents.create("考察.md");
    assert.equal(created.content, "");
    const text = "# 題\n\n私は😀考える。\r\n改行も残す。";
    await documents.save("考察.md", text, created.contentHash);

    // サービスを作り直して、再起動後の読み込みを再現する。
    const reopened = await createDocumentService(workspace).read("考察.md");
    assert.equal(reopened.content, text);
    assert.equal(await fs.readFile(path.join(workspace, "考察.md"), "utf8"), text);
    assert.equal(reopened.contentHash, hashContent(text));
  });

  it("既存ファイルへの作成は上書きせずに拒否する", async () => {
    const { workspace } = await makeTempDirs();
    await writeFile(workspace, "a.md", "元の内容");
    const documents = createDocumentService(workspace);
    await assert.rejects(documents.create("a.md", "新しい内容"), (error: unknown) => error instanceof StudioError && error.status === 409);
    assert.equal(await fs.readFile(path.join(workspace, "a.md"), "utf8"), "元の内容");
  });

  it("A-02: 外部で書き換わったファイルへの保存は 409 になり、ファイルを変えない", async () => {
    const { workspace } = await makeTempDirs();
    const file = await writeFile(workspace, "a.md", "最初");
    const documents = createDocumentService(workspace);
    const opened = await documents.read("a.md");
    await fs.writeFile(file, "外部の編集", "utf8");
    await assert.rejects(
      documents.save("a.md", "Studioの編集", opened.contentHash),
      (error: unknown) => error instanceof StudioError && error.code === "conflict" && error.status === 409,
    );
    assert.equal(await fs.readFile(file, "utf8"), "外部の編集");
  });

  it("UTF-8 でないファイルは開かない", async () => {
    const { workspace } = await makeTempDirs();
    await fs.writeFile(path.join(workspace, "sjis.md"), Buffer.from([0x82, 0xa0, 0x82, 0xa2]));
    await assert.rejects(createDocumentService(workspace).read("sjis.md"), (error: unknown) => error instanceof StudioError && error.code === "not_utf8");
  });

  it("ハッシュは UTF-8 のバイト列、オフセットは UTF-16 で数える", async () => {
    const { workspace } = await makeTempDirs();
    const text = "前😀後";
    await writeFile(workspace, "a.md", text);
    const documents = createDocumentService(workspace);
    const opened = await documents.read("a.md");
    // 😀 は UTF-16 で2単位、UTF-8 で4バイト。
    assert.equal(text.indexOf("後"), 3);
    assert.equal(Buffer.byteLength(text, "utf8"), 10);
    const replaced = await documents.replaceRange(
      "a.md",
      { start: 3, end: 4, quote: "後", sourceDocumentHash: opened.contentHash },
      "あと",
    );
    assert.equal(replaced.content, "前😀あと");
  });

  it("引用とハッシュが一致しない範囲の置き換えを拒否する", async () => {
    const { workspace } = await makeTempDirs();
    await writeFile(workspace, "a.md", "一二三");
    const documents = createDocumentService(workspace);
    const opened = await documents.read("a.md");
    await assert.rejects(
      documents.replaceRange("a.md", { start: 0, end: 1, quote: "二", sourceDocumentHash: opened.contentHash }, "x"),
      (error: unknown) => error instanceof StudioError && error.code === "stale_proposal",
    );
    await assert.rejects(
      documents.replaceRange("a.md", { start: 0, end: 1, quote: "一", sourceDocumentHash: hashContent("別") }, "x"),
      (error: unknown) => error instanceof StudioError && error.code === "stale_proposal",
    );
    assert.equal((await documents.read("a.md")).content, "一二三");
  });

  it("一覧は Markdown だけを返し、隠しディレクトリ・node_modules・symlink を含めない", async () => {
    const { base, workspace } = await makeTempDirs();
    await writeFile(workspace, "a.md", "");
    await writeFile(workspace, "notes/b.markdown", "");
    await writeFile(workspace, "notes/c.txt", "");
    await writeFile(workspace, ".hidden/d.md", "");
    await writeFile(workspace, "node_modules/e.md", "");
    await writeFile(base, "outside.md", "");
    await fs.symlink(path.join(base, "outside.md"), path.join(workspace, "link.md"));
    const list = await createDocumentService(workspace).list();
    assert.deepEqual(
      list.map((document) => document.path),
      ["a.md", "notes/b.markdown"],
    );
  });
});
