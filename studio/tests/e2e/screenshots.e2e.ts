import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, openDocument, selectLine, test } from "./fixtures.ts";

// デザイン資料（docs/handoff/design/*.png）と見比べるための画面を保存する。
// ピクセル一致は求めず、構成と不変条件を目で確かめるために使う。
const outputDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "test-results", "screenshots");
const QUOTE = "しかし、AIと対話することが、いつも思考を深めるとは限らない。";

test("Focus / Discuss / Proposal の3画面（1440×900）", async ({ page, studio }) => {
  await openDocument(page, studio, "考えるということ.md");
  await page.screenshot({ path: path.join(outputDir, "focus-desktop.png"), animations: "disabled" });

  await selectLine(page, QUOTE);
  await expect(page.locator(".floatbar")).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "selection-desktop.png"), animations: "disabled" });
  await page.getByRole("button", { name: /どう読める/ }).click();
  await expect(page.getByTestId("ai-turn")).toHaveCount(1);
  await page.screenshot({ path: path.join(outputDir, "dialog-desktop.png"), animations: "disabled" });

  await page.getByRole("button", { name: /修正案を見る/ }).click();
  await expect(page.getByTestId("diff")).toBeVisible();
  await page.screenshot({ path: path.join(outputDir, "proposal-desktop.png"), animations: "disabled" });
});

test("狭い画面の対話シート（390×844）", async ({ page, studio }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDocument(page, studio, "考えるということ.md");
  await page.screenshot({ path: path.join(outputDir, "focus-mobile.png"), animations: "disabled" });
  await selectLine(page, "では、どのような");
  await page.getByRole("button", { name: /どう読める/ }).click();
  await expect(page.getByTestId("ai-turn")).toHaveCount(1);
  await page.screenshot({ path: path.join(outputDir, "dialog-mobile.png"), animations: "disabled" });
});
