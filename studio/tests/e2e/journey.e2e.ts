import { SAMPLE, expect, lineBoxes, openDocument, selectLine, test, waitSaved } from "./fixtures.ts";

const QUOTE = "しかし、AIと対話することが、いつも思考を深めるとは限らない。";

test.describe("執筆から採用までの主要フロー", () => {
  test.use({ files: {} });

  test("執筆→選択→AIへ質問→返答→気づき→提案→採用→再読込", async ({ page, studio }) => {
    await page.goto(studio.url);
    await expect(page.getByRole("heading", { name: "書きはじめる" })).toBeVisible();

    // 新規作成して、IME の変換を含む日本語を入力する（A-01）。
    await page.getByLabel("新しい原稿").fill("考えるということ");
    await page.getByRole("button", { name: "作成" }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await page.locator(".cm-content").click();
    await page.keyboard.insertText(SAMPLE);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", { text: "かんがえ", selectionStart: 4, selectionEnd: 4 });
    await cdp.send("Input.insertText", { text: "考え" });
    await page.keyboard.insertText("を残す。");
    await waitSaved(page);
    const written = `${SAMPLE}考えを残す。`;
    expect(await studio.readFile("考えるということ.md")).toBe(written);

    // 入力と保存だけではAIを呼ばない（B-02）。
    expect(await studio.aiCalls()).toHaveLength(0);

    // 選択して「どう読める？」（B-01）。
    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /どう読める/ }).click();
    const panel = page.getByTestId("discuss-panel");
    await expect(panel.getByTestId("ai-turn")).toHaveCount(1);
    await expect(panel.getByText("こう読めました")).toBeVisible();
    await expect(panel.getByText("確認したいこと")).toBeVisible();
    await expect(panel.getByTestId("send-scope")).toContainText("選択文・前後の限定文脈・この対話");
    const calls = await studio.aiCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.selection).toBe(QUOTE);
    expect(calls[0]?.surroundingContext).not.toContain("# 文章を書くということ");

    // 反論して、AIが読みを改める（B-03）。
    await panel.getByRole("button", { name: "それは違う" }).click();
    await panel.getByLabel("あなたの返答").fill("それは違う。対話の回数ではなく、照らし合わせる過程が大事だと思う。");
    await panel.getByRole("button", { name: "返答する" }).click();
    await expect(panel.getByTestId("ai-turn")).toHaveCount(2);
    await expect(panel.getByTestId("author-turn")).toContainText("照らし合わせる過程");

    // 気づきは本人が入力したものだけを保存する。
    await panel.getByRole("button", { name: "気づきを記録" }).click();
    await panel.getByLabel("気づきを自分の言葉で書く").fill("AIの問いに答えることより、問いを検討する時間が大事なのかもしれない。");
    await panel.getByRole("button", { name: "気づきを保存" }).click();
    await expect(panel.getByTestId("insight")).toHaveCount(1);

    // 修正案を作り、差分を確認して採用する（C-02）。
    await panel.getByRole("button", { name: /修正案を見る/ }).click();
    const proposal = page.getByTestId("proposal-panel");
    await expect(proposal.getByTestId("diff")).toContainText(QUOTE);
    await expect(proposal.getByText("承認するまで原稿は変更されません")).toBeVisible();
    expect(await studio.readFile("考えるということ.md")).toBe(written);
    await proposal.getByRole("button", { name: "この修正を採用" }).click();
    await expect(proposal.getByText("この修正を採用しました")).toBeVisible();
    const replacement = "しかし、問いを受け取るだけでは思考は深まらない。自分の考えと照らし合わせて初めて、対話に価値が生まれる。";
    const adopted = written.replace(QUOTE, replacement);
    await expect.poll(() => studio.readFile("考えるということ.md")).toBe(adopted);
    await expect(page.locator(".cm-content")).toContainText(replacement);

    // 再読み込みしても、原稿・対話・気づき・採用の判断が残る。
    await page.reload();
    await expect(page.locator(".cm-content")).toContainText(replacement);
    await waitSaved(page);
    expect((await page.locator(".cm-line").allTextContents()).join("\n")).toBe(adopted);
    await page.getByRole("button", { name: /^対話/ }).click();
    const list = page.getByTestId("threads-panel");
    await expect(list.getByText("発言 3件・気づき 1件")).toBeVisible();
    await list.getByRole("button", { name: /しかし/ }).click();
    await expect(page.getByTestId("discuss-panel").getByTestId("insight")).toContainText("問いを検討する時間");
    // 採用で本文が変わったため、元の対話は古い位置として示す。
    await expect(page.getByTestId("thread-status")).toContainText("古い位置");
    expect(await studio.readFile("考えるということ.md")).toBe(adopted);
  });
});

test.describe("AIの扱い", () => {
  test("B-02: 選択せずに書いて保存しても、AIを一度も呼ばず割り込みもない", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("\n書き足した段落。AIには尋ねない。\n");
    await waitSaved(page);
    await page.waitForTimeout(500);
    expect(await studio.aiCalls()).toHaveLength(0);
    await expect(page.locator(".panel")).toHaveCount(0);
    await expect(page.locator(".floatbar")).toHaveCount(0);
  });

  test("C-01: 修正案を破棄しても原稿は1バイトも変わらない", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    const before = await studio.readFile("考えるということ.md");
    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /別の見方は/ }).click();
    await expect(page.getByTestId("ai-turn")).toHaveCount(1);
    await expect(page.getByText("判断できないこと")).toBeVisible();
    await page.getByRole("button", { name: /修正案を見る/ }).click();
    await page.getByTestId("proposal-panel").getByRole("button", { name: "破棄" }).click();
    await expect(page.getByText("この修正案は破棄しました")).toBeVisible();
    expect(await studio.readFile("考えるということ.md")).toBe(before);
    await expect(page.locator(".cm-content")).toContainText(QUOTE);
  });

  test("C-03: 提案の後でファイルが変わったら採用を拒否し、選択し直しを求める", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /どう読める/ }).click();
    await expect(page.getByTestId("ai-turn")).toHaveCount(1);
    await page.getByRole("button", { name: /修正案を見る/ }).click();
    await expect(page.getByTestId("diff")).toBeVisible();
    const edited = SAMPLE.replace("では、", "それでは、");
    await studio.writeFile("考えるということ.md", edited);
    await page.getByRole("button", { name: "この修正を採用" }).click();
    await expect(page.getByTestId("proposal-panel").getByRole("alert")).toContainText("元の文章が変更されています");
    await expect(page.getByRole("button", { name: /強制/ })).toHaveCount(0);
    expect(await studio.readFile("考えるということ.md")).toBe(edited);
  });

  test("C-05: 本文を変えた後の対話は古い位置として示し、別の場所へ付け直さない", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /どう読める/ }).click();
    await expect(page.getByTestId("ai-turn")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("追記。");
    await waitSaved(page);
    await page.getByRole("button", { name: /^対話/ }).click();
    await expect(page.getByTestId("threads-panel").getByText("位置が古い")).toBeVisible();
    await page.getByTestId("threads-panel").getByRole("button", { name: /しかし/ }).click();
    await expect(page.getByTestId("thread-status")).toContainText("古い位置");
    await expect(page.getByRole("button", { name: /修正案を見る/ })).toBeDisabled();
    await expect(page.locator("[data-highlight]")).toHaveCount(0);
  });
});

test.describe("AI未設定", () => {
  test.use({ aiEnabled: false });

  test("A-04: 「どう読める？」で設定が必要と示し、偽の回答を出さない", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /どう読める/ }).click();
    const panel = page.getByTestId("ai-unconfigured");
    await expect(panel).toContainText("AIが設定されていないため、尋ねられません");
    await expect(panel).toContainText("OPENAI_API_KEY");
    await expect(page.getByTestId("ai-turn")).toHaveCount(0);
    // 執筆と保存はそのまま使える。
    await page.keyboard.press("Escape");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("AIなしでも書ける。");
    await waitSaved(page);
    expect(await studio.readFile("考えるということ.md")).toBe(`${SAMPLE}AIなしでも書ける。`);
  });
});

test.describe("保存と競合", () => {
  test("A-02: 外部で書き換えられたファイルへの保存は競合として示し、未保存の入力を失わない", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await studio.writeFile("考えるということ.md", "外部エディタで書き換えた内容\n");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("Studioで書いた未保存の一文。");
    await expect(page.getByTestId("conflict-banner")).toBeVisible();
    await expect(page.getByTestId("save-status")).toHaveText("競合しています");
    await expect(page.locator(".cm-content")).toContainText("Studioで書いた未保存の一文。");
    expect(await studio.readFile("考えるということ.md")).toBe("外部エディタで書き換えた内容\n");

    // 明示的に選べば自分の版で上書きできる。
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "自分の版で上書き保存" }).click();
    await waitSaved(page);
    expect(await studio.readFile("考えるということ.md")).toBe(`${SAMPLE}Studioで書いた未保存の一文。`);
  });

  test("Cmd/Ctrl+S ですぐに保存できる", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.insertText("すぐ保存。");
    await page.keyboard.press("ControlOrMeta+s");
    await waitSaved(page);
    expect(await studio.readFile("考えるということ.md")).toBe(`${SAMPLE}すぐ保存。`);
  });
});

test.describe("既存ハーネス", () => {
  test.use({
    files: {
      "考えるということ.md": "# 題\n\n私は**強く**思う。\n",
      "clean.md": "# 題\n\n私はそう思う。\n",
      "契約あり.md": "# 題\n\n本文。\n",
      "契約あり.md.intent.yml": "schemaVersion: 1\n",
    },
  });

  test("C-04: 「検査」で既存CLIの結果を表示し、指摘の行へ移動できる", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await page.getByRole("button", { name: "検査", exact: true }).click();
    const panel = page.getByTestId("check-panel");
    await expect(panel.getByTestId("check-result")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByTestId("check-summary")).toContainText("警告 1");
    const finding = panel.getByRole("button", { name: /太字が使われています/ });
    await expect(finding).toContainText("3行目");
    await finding.click();
    const line = await page.locator(".cm-content").evaluate(() => {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      return element?.closest(".cm-line")?.textContent ?? null;
    });
    expect(line).toBe("私は**強く**思う。");
    expect(await studio.aiCalls()).toHaveLength(0);
  });

  test("C-04: 指摘がなければ0件と明示し、文書契約を読み取り専用で示す", async ({ page, studio }) => {
    await openDocument(page, studio, "clean.md");
    await page.getByRole("button", { name: "検査", exact: true }).click();
    await expect(page.getByTestId("check-empty")).toHaveText("指摘は0件でした。", { timeout: 30_000 });
    await page.getByRole("button", { name: "文書契約" }).click();
    await expect(page.getByTestId("contract-missing")).toContainText("未設定");
    await page.getByRole("button", { name: "原稿を選ぶ" }).click();
    await page.getByTestId("documents-panel").getByRole("button", { name: /契約あり/ }).click();
    await page.getByRole("button", { name: "文書契約" }).click();
    await expect(page.getByTestId("contract-panel")).toContainText("契約あり.md.intent.yml");
    await expect(page.getByTestId("contract-panel")).toContainText("schemaVersion: 1");
  });
});

test.describe("画面の不変条件", () => {
  test("UX-01: AIパネルの開閉で本文の行の位置と折り返しが変わらない", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    const before = await lineBoxes(page);
    const scrollBefore = await page.locator(".writing-area").evaluate((element) => element.scrollTop);
    await selectLine(page, QUOTE);
    await page.getByRole("button", { name: /どう読める/ }).click();
    await expect(page.getByTestId("ai-turn")).toHaveCount(1);
    expect(await lineBoxes(page)).toEqual(before);
    await page.getByRole("button", { name: /修正案を見る/ }).click();
    await expect(page.getByTestId("diff")).toBeVisible();
    expect(await lineBoxes(page)).toEqual(before);
    await page.getByRole("button", { name: "パネルを閉じて原稿に戻る" }).click();
    expect(await lineBoxes(page)).toEqual(before);
    expect(await page.locator(".writing-area").evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  });

  test("UX-02: キーボードだけで尋ね、パネルを閉じて書き続けられる", async ({ page, studio }) => {
    await openDocument(page, studio, "考えるということ.md");
    await selectLine(page, QUOTE);
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByRole("button", { name: /どう読める/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("ai-turn")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator(".panel")).toHaveCount(0);
    await expect(page.locator(".cm-content")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.insertText("続きを書く。");
    await waitSaved(page);
    expect(await studio.readFile("考えるということ.md")).toContain("限らない。続きを書く。");
  });

  test("UX-03: 環境音は初期状態で無音、オンで再生しオフで止まり、音量を変えられる", async ({ page, studio }) => {
    await page.addInitScript(() => {
      const contexts: AudioContext[] = [];
      const Original = window.AudioContext;
      (window as unknown as { __contexts: AudioContext[] }).__contexts = contexts;
      window.AudioContext = class extends Original {
        constructor(options?: AudioContextOptions) {
          super(options);
          contexts.push(this);
        }
      };
    });
    await openDocument(page, studio, "考えるということ.md");
    const toggle = page.getByTestId("sound-toggle");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => (window as unknown as { __contexts: AudioContext[] }).__contexts.length)).toBe(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => (window as unknown as { __contexts: AudioContext[] }).__contexts[0]?.state)).toBe("running");
    await page.getByLabel("環境音の音量").fill("70");
    await expect(page.getByText("音量 70%")).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(page.getByText("音量 70%")).toBeVisible();
    await expect(page.getByTestId("sound-toggle")).toHaveAttribute("aria-pressed", "false");
  });

  test("狭い画面では対話を下からのシートで開き、閉じられる", async ({ page, studio }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // 出現アニメーションの途中で寸法を測らないよう、モーションを止める。
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDocument(page, studio, "考えるということ.md");
    await selectLine(page, "では、どのような");
    await page.getByRole("button", { name: /どう読める/ }).click();
    const panel = page.getByTestId("discuss-panel");
    await expect(panel.getByTestId("ai-turn")).toHaveCount(1);
    const box = await panel.boundingBox();
    expect(box?.width).toBe(390);
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(844);
    await expect(panel.getByRole("button", { name: "返答する" })).toBeVisible();
    await panel.getByRole("button", { name: "パネルを閉じて原稿に戻る" }).click();
    await expect(page.locator(".panel")).toHaveCount(0);
  });
});
