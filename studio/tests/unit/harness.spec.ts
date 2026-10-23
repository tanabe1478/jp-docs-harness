import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { StudioError } from "../../src/server/errors.ts";
import { createDocumentService } from "../../src/server/services/documents.ts";
import { DEFAULT_HARNESS_BIN, createHarnessService, inspectHarness } from "../../src/server/services/harness.ts";
import { makeTempDirs, writeFile } from "../fixtures/temp.ts";

const harnessAvailable = inspectHarness(DEFAULT_HARNESS_BIN).available;

describe("既存ハーネスとの接続", () => {
  it(
    "C-04: 既存CLIの check を実行し、その指摘をそのまま返す",
    { skip: harnessAvailable ? false : "リポジトリのルートで npm install が必要" },
    async () => {
      const { workspace } = await makeTempDirs();
      await writeFile(workspace, "a.md", "# 題\n\n私は**強く**思う。\n");
      await writeFile(workspace, "clean.md", "# 題\n\n私はそう思う。\n");
      const documents = createDocumentService(workspace);
      const harness = createHarnessService({ root: workspace, documents });

      const result = await harness.check("a.md");
      assert.equal(result.documents, 1);
      assert.equal(result.exitCode, 0);
      const bold = result.findings.find((finding) => finding.ruleId === "style/bold-forbidden");
      assert.ok(bold, "太字の指摘が既存CLIから返る");
      assert.equal(bold.location?.startLine, 3);

      const clean = await harness.check("clean.md");
      assert.equal(clean.findings.length, 0);
      assert.equal(clean.summary.findings, 0);
    },
  );

  it("CLIの異常終了（終了コード2）は結果として扱わない", async () => {
    const { workspace, base } = await makeTempDirs();
    await writeFile(workspace, "a.md", "本文\n");
    const bin = await writeFile(base, "fake-cli/bin/cli.mjs", "process.stderr.write('jp-docs-harness: 失敗'); process.exit(2);\n");
    await writeFile(base, "fake-cli/node_modules/textlint/package.json", "{}");
    const harness = createHarnessService({ root: workspace, documents: createDocumentService(workspace), bin });
    await assert.rejects(harness.check("a.md"), (error: unknown) => error instanceof StudioError && error.code === "harness_failed");
  });

  it("時間がかかりすぎる検査はタイムアウトにする", async () => {
    const { workspace, base } = await makeTempDirs();
    await writeFile(workspace, "a.md", "本文\n");
    const bin = await writeFile(base, "slow-cli/bin/cli.mjs", "setTimeout(() => {}, 10000);\n");
    await writeFile(base, "slow-cli/node_modules/textlint/package.json", "{}");
    const harness = createHarnessService({ root: workspace, documents: createDocumentService(workspace), bin, timeoutMs: 300 });
    await assert.rejects(harness.check("a.md"), (error: unknown) => error instanceof StudioError && error.code === "harness_timeout");
  });

  it("引数をシェルに通さず、ファイル名の記号をそのまま渡す", async () => {
    const { workspace, base } = await makeTempDirs();
    await writeFile(workspace, "a;echo pwned.md", "本文\n");
    const bin = await writeFile(
      base,
      "echo-cli/bin/cli.mjs",
      "process.stdout.write(JSON.stringify({schemaVersion:1,documents:[{path:process.argv.at(-1)}],findings:[],summary:{findings:0,errors:0,warnings:0,infos:0}}));\n",
    );
    await writeFile(base, "echo-cli/node_modules/textlint/package.json", "{}");
    const harness = createHarnessService({ root: workspace, documents: createDocumentService(workspace), bin });
    const result = await harness.check("a;echo pwned.md");
    assert.equal(result.documents, 1);
  });

  it("文書契約がなければ「未設定」、あれば読み取り専用で内容を返す", async () => {
    const { workspace } = await makeTempDirs();
    await writeFile(workspace, "a.md", "本文\n");
    const documents = createDocumentService(workspace);
    const harness = createHarnessService({ root: workspace, documents });
    assert.deepEqual(await harness.contract("a.md"), { status: "missing", contractPath: "a.md.intent.yml" });

    await writeFile(workspace, "a.md.intent.yml", "schemaVersion: 1\nprofile: design-doc\n");
    const present = await harness.contract("a.md");
    assert.equal(present.status, "present");
    if (present.status === "present") assert.match(present.source, /profile: design-doc/);
  });
});
