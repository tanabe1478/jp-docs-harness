// デスクトップ版の通しのテストで、実際のウィンドウ（macOS は WKWebView、Linux は WebKitGTK）の中で実行するスクリプト。
// debug ビルドの JP_DOCS_STUDIO_E2E_SCRIPT から、Studio の画面を読み込むたびに実行される。
// CSP により外部へは送れないため、結果は同じオリジンの API で workspace の Markdown として書き出す。
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (probe, label, timeout = 20000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const value = probe();
      if (value) return value;
      await sleep(100);
    }
    throw new Error(`見つかりません: ${label}`);
  };
  const byText = (selector, pattern) => [...document.querySelectorAll(selector)].find((element) => pattern.test(element.textContent ?? ""));
  const headers = { "x-jp-docs-studio": "1", "content-type": "application/json" };
  const report = (name, data) =>
    fetch("/api/documents", { method: "POST", headers, body: JSON.stringify({ path: name, content: `${JSON.stringify(data, null, 2)}\n` }) });

  let goSeen = false;
  const watchGo = setInterval(async () => {
    const list = await (await fetch("/api/documents", { headers })).json();
    if (list.documents.some((document) => document.path === "e2e-go.md")) {
      goSeen = true;
      clearInterval(watchGo);
    }
  }, 300);
  // テストではウィンドウが背面にあり描画が止まりやすい。出現アニメーションの途中で撮影しないよう止める。
  const calm = document.createElement("style");
  calm.textContent = ".panel { animation: none !important; }";
  document.head.append(calm);
  const config = await (await fetch("/api/config", { headers })).json();
  const result = { workspace: config.workspaceName, native: config.native, tauri: typeof window.__TAURI_INTERNALS__ === "object", steps: [] };
  try {
    if (config.workspaceName === "ws-first") {
      (await waitFor(() => byText("button", /考えるということ/), "原稿のボタン")).click();
      const content = await waitFor(() => document.querySelector(".cm-content"), "エディタ");
      result.steps.push("opened");

      // ウィンドウの WebView での入力から自動保存まで。IME ではなく、確定した文字列の入力として行う。
      content.focus();
      const selection = window.getSelection();
      selection.selectAllChildren(content);
      selection.collapseToEnd();
      const status = () => document.querySelector("[data-testid=save-status]")?.textContent;
      document.execCommand("insertText", false, "WKWebViewで書いた一文。");
      // 入力直後はまだ「保存済み」のままなので、いったん未保存になったことを確かめてから保存を待つ。
      await waitFor(() => status() !== "保存済み", "未保存の表示");
      await waitFor(() => status() === "保存済み", "保存済み", 30000);
      result.steps.push("typed-and-saved");

      // 参考資料: ネイティブのファイル選択（テストではダイアログの代わりに決まったファイル）から登録する。
      byText("button.tool", /^資料/).click();
      (await waitFor(() => byText("button", /ファイルを選ぶ/), "ファイルを選ぶボタン")).click();
      const item = await waitFor(() => byText("[data-testid=reference]", /外部の資料\.md/), "外部の資料");
      result.steps.push(`picked: ${item.textContent}`);
      result.referenceButton = byText("button.tool", /^資料/)?.textContent;
      result.panelAtReport = document.querySelector(".panel")?.getAttribute("data-testid") ?? null;
      result.visibility = document.visibilityState;
      await report("e2e-first.md", result);
      // テスト側が撮影を終えて合図のファイル（e2e-go.md）を置くまで待つ。
      await waitFor(
        () => goSeen,
        "撮影の合図",
        60000,
      );

      await report("e2e-first-after.md", { panelAfterShot: document.querySelector(".panel")?.getAttribute("data-testid") ?? null, visibility: document.visibilityState });
      // workspace の選び直し（テストではダイアログの代わりに決まったフォルダ）。
      document.querySelector(".panel .x")?.click();
      document.querySelector("button.docname").click();
      (await waitFor(() => byText("button", /workspace を選び直す/), "workspace を選び直すボタン")).click();
    } else if (config.workspaceName === "ws-second") {
      await waitFor(() => byText("button", /二つ目の原稿/), "二つ目の workspace の原稿");
      result.steps.push("switched");
      await report("e2e-second.md", result);
    }
  } catch (error) {
    result.error = String(error);
    await report(`e2e-error-${config.workspaceName}.md`, result);
  }
})();
