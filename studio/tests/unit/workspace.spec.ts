import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { StudioError } from "../../src/server/errors.ts";
import {
  normalizeRelativePath,
  resolveExistingFile,
  resolveNewFile,
  resolveWorkspaceRoot,
} from "../../src/server/security/workspace.ts";
import { makeTempDirs, writeFile } from "../fixtures/temp.ts";

function rejectsWith(code: string) {
  return (error: unknown) => error instanceof StudioError && error.code === code;
}

describe("workspace のパス境界", () => {
  it("workspace は絶対パスの既存ディレクトリだけを受け付ける", async () => {
    const { workspace } = await makeTempDirs();
    assert.equal(await resolveWorkspaceRoot(workspace), workspace);
    await assert.rejects(resolveWorkspaceRoot("relative/path"), /絶対パス/);
    await assert.rejects(resolveWorkspaceRoot(path.join(workspace, "missing")), /見つかりません/);
    await assert.rejects(resolveWorkspaceRoot(undefined), /--workspace/);
  });

  it("../ や絶対パス、Windows 形式の絶対パスを拒否する", () => {
    for (const input of ["../secret.md", "a/../../secret.md", "/etc/passwd.md", "C:\\secret.md", "c:secret.md", "\\\\server\\share\\a.md", "a\\..\\..\\b.md"]) {
      assert.throws(() => normalizeRelativePath(input), rejectsWith("outside_workspace"), input);
    }
  });

  it("区切りに / と \\ の両方を受け付け、/ 区切りで返す", () => {
    assert.deepEqual(normalizeRelativePath("notes\\今日.md"), ["notes", "今日.md"]);
    assert.deepEqual(normalizeRelativePath("notes/今日.md"), ["notes", "今日.md"]);
  });

  it("隠しファイルと NUL を含むパスを拒否する", () => {
    assert.throws(() => normalizeRelativePath(".git/config.md"), rejectsWith("invalid_path"));
    assert.throws(() => normalizeRelativePath("a\0.md"), rejectsWith("invalid_path"));
  });

  it("A-03: workspace 外を指す symlink を拒否し、内容を返さない", async () => {
    const { base, workspace } = await makeTempDirs();
    await writeFile(base, "secret.md", "秘密の内容");
    await fs.symlink(path.join(base, "secret.md"), path.join(workspace, "link.md"));
    await fs.symlink(base, path.join(workspace, "outside-dir"));
    await assert.rejects(resolveExistingFile(workspace, "link.md"), rejectsWith("outside_workspace"));
    await assert.rejects(resolveExistingFile(workspace, "outside-dir/secret.md"), rejectsWith("outside_workspace"));
    await assert.rejects(resolveNewFile(workspace, "outside-dir/new.md"), rejectsWith("outside_workspace"));
  });

  it("workspace 内を指す symlink は実体へ解決して扱う", async () => {
    const { workspace } = await makeTempDirs();
    const real = await writeFile(workspace, "real.md", "本文");
    await fs.symlink(real, path.join(workspace, "alias.md"));
    const resolved = await resolveExistingFile(workspace, "alias.md");
    assert.equal(resolved.absolute, real);
  });

  it("Markdown 以外と上限を超えるファイルを拒否する", async () => {
    const { workspace } = await makeTempDirs();
    await writeFile(workspace, "a.txt", "x");
    await writeFile(workspace, "big.md", "あ".repeat(10));
    await assert.rejects(resolveExistingFile(workspace, "a.txt"), rejectsWith("not_markdown"));
    await assert.rejects(resolveExistingFile(workspace, "big.md", { maxBytes: 5 }), rejectsWith("too_large"));
    await assert.rejects(resolveExistingFile(workspace, "none.md"), rejectsWith("not_found"));
  });
});
