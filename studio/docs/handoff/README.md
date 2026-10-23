# jp-docs Studio — coding-agent handoff package v0.3

このZIPを展開し、**`jp-docs-studio-agent-prompt-v0.3.md`** をコーディングエージェントに送り、同梱ファイルをすべて読ませてください。作業対象は `https://github.com/tanabe1478/jp-docs-harness` です。

## まず見るもの

1. `jp-docs-studio-agent-handoff-v0.3.md` — 実装の契約。MVP、セキュリティ、型・API、受け入れテスト。
2. `studio-visual-spec-v0.3.md` — 画面ごとの状態・操作・レイアウト・デザイントークン。
3. `design/screens-overview.png` — 3画面とモバイル構成の一覧（閲覧の入口）。
4. `design/focus-desktop.png` / `dialog-desktop.png` / `proposal-desktop.png` — 実装で再現する中核3画面。
5. `design/dialog-mobile.png` — 狭幅画面の参考。
6. `design/studio-mockups.html` — 編集可能な静的HTML/CSSの画面資料。ブラウザで開き `?view=focus`, `?view=dialog`, `?view=proposal` を切り替えられる。**インタラクティブな完成アプリではない。**
7. `jp-docs-studio-concept-v0.1.md` — 製品思想の補助資料。
8. `design/atmosphere-moodboard.png` — AI生成の雰囲気資料。画面の厳密な実装基準ではなく、MVP対象外の演出を含む。

## デザイン上の最重要条件

**文章の位置を変えずにAIへアクセスできること。** OmmWriterに着想を得た「静けさ」「自然な光」「余白」「任意の環境音」は取り入れ、製品固有の素材やUI配置は複製しない。

**仕様の優先順位**：実装指示書 > 画面仕様 > 静的HTML/スクリーンショット > ムードボード。実装済みでない部分は未実装と報告する。
