import { SAMPLE, expect, openDocument, selectLine, test } from "./fixtures.ts";

const QUOTE = "しかし、AIと対話することが、いつも思考を深めるとは限らない。";

test.describe("参考資料", () => {
  test.use({
    files: {
      "考えるということ.md": SAMPLE,
      "資料/背景.txt": "対話に価値を感じた例: 問いを自分の経験と照らし合わせた。",
      "資料/メモ.md": "# メモ\n\n添えないメモ。",
    },
  });

  test("workspace の資料を選んで添え、AIへ送った資料を対話に示す", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await page.getByRole("button", { name: /^資料/ }).click();
    const panel = page.getByTestId("references-panel");
    await panel.getByLabel("workspace のファイルを加える").selectOption("資料/背景.txt");
    await panel.getByRole("button", { name: "加える" }).click();
    await panel.getByLabel("workspace のファイルを加える").selectOption("資料/メモ.md");
    await panel.getByRole("button", { name: "加える" }).click();
    await expect(panel.getByTestId("reference")).toHaveCount(2);
    // メモは添えない。
    await panel.getByTestId("reference").filter({ hasText: "資料/メモ.md" }).getByLabel("AIに添える").uncheck();
    await expect(panel.getByText("いまは 1件")).toBeVisible();
    await expect(panel).toContainText("デスクトップ版でファイルを選んで加えられます");
    await expect(page.getByRole("button", { name: "資料 1" })).toBeVisible();

    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /どう読める/ }).click();
    const discuss = page.getByTestId("discuss-panel");
    await expect(discuss.getByTestId("ai-turn")).toHaveCount(1);
    await expect(discuss.getByTestId("send-scope")).toContainText("参考資料1件");
    await expect(discuss.getByTestId("send-scope")).toContainText("資料1件");

    const calls = await studio.aiCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0] as { references?: Array<{ name: string }> }).references?.map((item) => item.name)).toEqual(["資料/背景.txt"]);

    // 再読み込みしても資料の選択は残る。
    await page.reload();
    await expect(page.getByRole("button", { name: "資料 1" })).toBeVisible();
  });
});

test.describe("AIの設定", () => {
  test.use({ aiEnabled: false });

  test("AI未設定の案内から設定パネルを開き、固定構成では変更できないと示す", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await page.getByRole("button", { name: "AIの設定" }).click();
    const panel = page.getByTestId("ai-settings-panel");
    await expect(panel.getByTestId("ai-state")).toContainText("OPENAI_API_KEY");
    await expect(panel).toContainText("画面から変えられません");
  });
});
