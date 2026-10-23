# jp-docs Studio

AIと対話しながら、自分の考えを確かめて書くためのローカルの執筆環境です。原稿はworkspace内のMarkdownをそのまま編集します。選んだ箇所についてAIに「どう読める？」「別の見方は？」と尋ね、返答・保留・却下・気づきの記録を残せます。AIの修正案は差分を見て採用した場合だけ原稿に反映します。

AIは入力中にも保存時にも呼び出しません。呼ぶのは、選択箇所のボタンか対話パネルのボタンを押したときだけです。

ブラウザで使うWeb版と、macOSのデスクトップ版（Tauri）があります。どちらも同じサーバーと画面を使います。

jp-docs-harness本体（CLI、pi package、Claude Code Plugin）とは依存関係を分けています。Studioは本体の`bin/jp-docs-harness.mjs`を子プロセスとして呼ぶだけで、本体からStudioは参照しません。

## デスクトップ版

### ビルド

RustとXcodeのコマンドラインツールが必要です（Rust 1.97.1でビルドを確認しました）。

```sh
cd studio
npm install
npm run desktop:build
```

`src-tauri/target/release/bundle/`に`jp-docs Studio.app`と`.dmg`ができます。ビルドの途中で`scripts/stage-desktop.mjs`が、同梱する実行環境を`src-tauri/runtime/`と`src-tauri/binaries/`に組み立てます。

同梱するものは次のとおりです。

- このNode本体（`src-tauri/binaries/node-<target>`）
- Studioのサーバー（TypeScriptのまま）、ビルド済みの画面、本番用の依存
- jp-docs-harnessのCLI（`bin`、`lib`、`schemas`）と本番用の依存（textlintなど）

`desktop:build`は`CI=true`を付けて`tauri build`を実行します。`.dmg`を作る際のFinderの見た目を整える処理が、ディスクイメージを使用中のままにして失敗することがあるため、その処理を省いています。

開発中は`npm run desktop:dev`で、配布用のバンドルを作らずに起動できます。

### 署名

アプリはアドホック署名（`signingIdentity: "-"`）で、hardened runtimeを有効にして署名します。同梱のNode（V8）は実行時に機械語を生成するため、`src-tauri/Entitlements.plist`でJITを許可しています。これがないと、署名したアプリではサーバーが起動しません。

アドホック署名のアプリは、ビルドしたMacで使う分には動きます。ほかの人へ配る場合は、Apple Developer ProgramのDeveloper ID証明書での署名とAppleの公証が必要です。このリポジトリでは設定していません。

### 起動と使い方

初回の起動では、執筆に使うフォルダ（workspace）を選びます。次回からは同じworkspaceを開きます。選び直すには、原稿の一覧にある「workspace を選び直す…」を使います。

アプリは同梱のNodeでサーバーを`127.0.0.1`の空いているポートに起動し、その画面をウィンドウに表示します。アプリを終了するとサーバーも終了します。アプリが異常終了した場合も、サーバーは標準入力のパイプが閉じたことを検知して終了します。

デスクトップ版だけの機能は次の二つです。

- 参考資料に、workspaceの外のファイルを選んで加えられる（OSのファイル選択ダイアログを使う）
- ChatGPTのログイン画面を既定のブラウザで開く

画面からネイティブ機能へ渡すのは、ファイル選択・URLを開く・workspaceの選び直し・接続の確認の四つのコマンドだけです。外部ファイルの登録は、アプリ本体だけが知るトークンでサーバーへ送るため、画面のJavaScriptからは任意のパスを登録できません。

### 対応環境

macOS（Apple Silicon）とLinux（Debian系。確認したのはarm64）を対象にしています。Windowsは対象外です。コードはWindowsのパスも扱うように書いていますが、ビルドも起動も確認していません。

デスクトップ版の設定は`~/Library/Application Support/jp.tanabe1478.jp-docs-studio/desktop.json`に、サーバーのログは`~/Library/Logs/jp.tanabe1478.jp-docs-studio/studio-server.log`に書き込みます。

## Web版

Node.js 22.18以降が必要です。サーバーのTypeScriptを、Nodeの型除去で直接実行するためです。検査を使う場合は、リポジトリのルートで`npm install`を済ませておきます。

```sh
cd studio
npm install
npm run dev -- --workspace /absolute/path/to/writing-workspace
```

起動するとURLを表示します。既定は`http://127.0.0.1:4873/`です。`--port`で変更できます。サーバーは`127.0.0.1`だけで待ち受けます。

ビルド済みの画面で動かす場合は次のとおりです。

```sh
npm run build
npm start -- --workspace /absolute/path/to/writing-workspace
```

`--workspace`には絶対パスを指定します。Studioが原稿として読み書きするのは、その配下のMarkdown（`.md`、`.markdown`）だけです。

## AIの設定

画面右上の「AI」から設定します。どちらも設定しなくても、執筆・保存・検査は使えます。その場合、AIのボタンは設定が必要であることだけを表示し、回答らしきものは出しません。

- ChatGPTのサブスクリプション（Sign in with ChatGPT）。「ChatGPT でログイン」を押し、ブラウザでログインします。Web版では端末で`npm run login`も使えます。
- OpenAI API。環境変数`OPENAI_API_KEY`を設定してサーバーを起動します。利用料はChatGPTの有料プランとは別に課金されます。

使うモデルも「AI」の画面で選びます。選んだモデルは`settings.json`に保存し、起動し直さずに反映します。次の環境変数を設定した場合は、画面の設定より環境変数を優先します。

| 環境変数 | 内容 |
| --- | --- |
| `JP_DOCS_STUDIO_MODEL` | 使用するモデル名 |
| `OPENAI_API_KEY` | OpenAI APIのキー（APIで使う場合） |
| `JP_DOCS_STUDIO_AI` | `chatgpt`か`openai-api`。省略するとChatGPTにログイン済みならChatGPT、そうでなければAPIキーを使う |

ChatGPTでの呼び出しには[pi-ai](https://github.com/earendil-works/pi/tree/main/packages/ai)の`openai`プロバイダーを使います。ログイン情報はデータ置き場の`credentials.json`に、所有者だけが読める権限で保存します。ブラウザと対話データには渡しません。トークンの更新もpi-aiが行います。

APIキーはサーバーの環境変数からだけ読みます。ブラウザ、ログ、保存する対話データには書き込みません。

AIへ送るのは次の範囲だけです。原稿全体は送りません。

- 選択した文
- 選択箇所を含む段落の前後1段落（前後それぞれ最大2000字）
- その対話の直近8件の発言
- 「添える」にした参考資料（1件8000字、合計24000字まで）

ChatGPTでもAPIキーでも、Responses APIへは`store: false`で送ります。

## 参考資料

ヘッダの「資料」から、原稿ごとに参考資料を選べます。対象はMarkdownとテキスト（`.md`、`.markdown`、`.txt`）です。Web版ではworkspace内のファイルを、デスクトップ版ではworkspaceの外のファイルも加えられます。

資料ごとに「AIに添える」を切り替えられます。AIへ送った資料は、その対話の記録に名前・ハッシュ・字数だけを残します。資料の中に指示が書かれていても、原稿と同じくAIは従わないよう指示しています。

## 保存先と削除

原稿はworkspace内のMarkdownファイルです。対話・気づき・修正案・参考資料の一覧はworkspaceの外に、workspaceの実体パスのハッシュごとに保存します。

| OS | 保存先 |
| --- | --- |
| macOS | `~/Library/Application Support/jp-docs-studio/workspaces/<hash>/studio.json` |
| Windows | `%APPDATA%\jp-docs-studio\workspaces\<hash>\studio.json` |
| Linux | `$XDG_DATA_HOME/jp-docs-studio/...`（未設定なら`~/.local/share/jp-docs-studio/...`） |

ChatGPTのログイン情報（`credentials.json`）、AIの設定（`settings.json`）、ログインに使うインストールのID（`device-id`）は、workspaceごとではなく`jp-docs-studio`の直下に一つずつ保存します。Web版とデスクトップ版で共有します。

`JP_DOCS_STUDIO_DATA_DIR`を設定すると、`jp-docs-studio`の代わりにそのディレクトリを使います。実際の保存先は画面の原稿一覧の下に表示します。

記録を消すには、Studioを止めてから該当する`workspaces/<hash>`ディレクトリを削除します。すべて消す場合は`jp-docs-studio`ディレクトリごと削除します。原稿のMarkdownは消えません。

## 使い方

1. 原稿を開くか、新しく作ります。入力をやめて1秒ほどで自動保存し、`Cmd/Ctrl+S`ですぐに保存できます。
2. 気になる文を選ぶと、上に「どう読める？」「別の見方は？」が出ます。キーボードでは、選択したまま`Cmd/Ctrl+Enter`でボタンへ移れます。
3. AIは「こう読めました」「そう考えた理由」「確認したいこと」を返します。返答・保留・却下・再開を選べます。
4. 気づきは、自分で入力して保存したものだけが残ります。AIの文が自動で気づきになることはありません。
5. 「修正案を見る」で、選択箇所だけの置換案を差分で確認します。「この修正を採用」を押したときだけ原稿が変わります。
6. ヘッダの「検査」は、保存済みの原稿に対して既存の`check`を実行し、その結果を表示します。指摘を押すとその行へ移動します。「文書契約」は`<原稿>.intent.yml`を読み取り専用で表示します。

`Esc`でパネルを閉じて原稿へ戻ります。右下の環境音は初期状態でオフです。Web Audioで生成した音で、音源ファイルは使いません。

## 競合と古くなった対話

保存時には、開いたときのハッシュと現在のファイルのハッシュを比べます。別のエディタなどでファイルが変わっていた場合は保存せず、競合として表示します。未保存の内容はエディタに残り、「自分の版で上書き保存」か「ファイルの版を読み込む」を選べます。

対話と修正案は、作成時の原稿のハッシュと選択位置に結び付けています。原稿のどこかが変わると、その対話は「位置が古い」と表示し、AIへの質問と修正案は使えなくなります。似た文へ自動で付け直すことはしません。修正案の採用時にも、ハッシュと選択した原文が一致しない場合は採用を拒否します。

## テスト

```sh
npm test               # ユニットテスト（Node Test Runner）
npm run test:e2e       # 画面をビルドし、Playwright（Chromium と WebKit）で主要フローを確認する
npm run typecheck      # 型検査
npm run test:ai-smoke  # 実際のモデルで1往復する（ログイン済みかキーがある場合だけ。利用枠や課金を消費します）
(cd src-tauri && cargo test)  # デスクトップ版の Rust 側
npm run test:desktop   # デスクトップ版の通しのテスト（macOS。debug ビルドを作って実際のウィンドウで操作する）
bash tests/desktop/linux-docker.sh  # Linux 版を Docker の中でビルドし、Xvfb の上で同じ通しのテストを実行する
```

デスクトップ版の通しのテストは、debugビルドだけが読む環境変数で、ファイル選択とworkspaceの選び直しのダイアログを決まったパスの返却に置き換えます。そのうえで、実際のウィンドウの中で`tests/desktop/in-window.js`を実行し、入力と自動保存、外部ファイルの参考資料の登録、workspaceの選び直し、強制終了時のサーバーの停止を確かめます。macOSでは`test-results/desktop/`にウィンドウを撮影します。releaseビルドにはこの置き換えは入りません。

テストのAIは`tests/fixtures/fake-adapter.ts`の偽物を使います。偽物は`tests/e2e/server.ts`からだけ読み込み、通常の起動には含めません。E2Eは`test-results/screenshots/`へFocus、Discuss、Proposal、狭い画面の画像を保存します。

デスクトップ版のmacOSは画面をWebKit（WKWebView）で動かすため、E2EはWebKitでも実行します。

Studioのテストファイルは`*.spec.ts`と`*.e2e.ts`です。リポジトリのルートの`npm test`（`node --test`）は`*.test.ts`も拾うため、名前を分けてルートのテストとして実行されないようにしています。

## 構成

| パス | 役割 |
| --- | --- |
| `src/server/security/` | workspaceのパス検証、Host・Origin・独自ヘッダー・ネイティブ用トークンの検査、CSP |
| `src/server/services/` | 原稿、対話と修正案、参考資料、AIへ送る文脈の切り出し、既存CLIの呼び出し |
| `src/server/providers/` | `AiAdapter`、pi-ai（ChatGPT）とOpenAI APIの実装、AIの設定とログイン、指示文 |
| `src/server/persistence/` | 対話データ、ログイン情報、設定の保存と、一時ファイルを経由した書き込み |
| `src/client/` | React、CodeMirror 6の画面 |
| `src-tauri/` | デスクトップ版（Tauri 2）。サーバーの起動、ネイティブ機能、権限の設定 |
| `scripts/stage-desktop.mjs` | デスクトップ版に同梱する実行環境の組み立て |
| `docs/handoff/` | 受け取った実装指示書、画面仕様、デザイン資料（原文のまま） |

## 制限と未確認の事項

- 実際のモデルでの動作は、2026-10-23にmacOSで、ChatGPTのログインと`gpt-6-sol`の組み合わせだけを確認しました（`npm run test:ai-smoke`とWeb版の画面からの質問）。`OPENAI_API_KEY`を使う場合は確認していません。
- ChatGPTのサブスクリプションで使えるモデルと利用枠は、pi-aiのモデル一覧とは別にOpenAI側で決まります。`gpt-6-sol`以外は確認していません。
- デスクトップ版は、2026-10-23に次の環境で、ビルドと通しのテスト（入力と自動保存、外部ファイルの参考資料の登録、workspaceの選び直し、強制終了時のサーバーの停止）を確認しました。
  - macOS 26（Apple Silicon）。releaseビルドをアドホック署名し、起動と検査の実行も確かめた
  - Linux（Debian bookworm、arm64）。Dockerの中でdebをインストールし、Xvfbの上で起動した
- 通しのテストでは、OSのファイル選択とフォルダ選択のダイアログそのものは決まったパスの返却に置き換えています。ダイアログの表示と操作は自動では確認していません。
- Linuxのx86_64版はビルドしていません。Windowsは対象外です。
- 公証はしていません。Developer ID証明書とAppleのアカウントが必要なためです。
- Web版のWindowsでの起動は確認していません。パスの検証はWindows形式の入力も扱うよう実装し、ユニットテストで確かめています。
- IMEの変換は、ChromiumのE2Eで開発者向けプロトコルを使って再現したものです。WebKit（デスクトップ版のウィンドウを含む）では確定した文字列の入力だけを確かめており、実際のOSのIMEでの変換は確認していません。
- workspaceを移動すると保存先のハッシュが変わり、それまでの対話は表示されません。
- 原稿のどこかを編集すると、その原稿の対話はすべて古い位置として扱います。
- 改行コードが混在するファイルは、開いたときに多い方へ揃え、保存時にその形で書き込みます。
- 開発モード（`npm run dev`）では、ViteのHMRのためにCSPの`script-src`と`connect-src`を緩めています。
- 画面はMarkdownのソースをそのまま表示します。見出しの記号なども表示されます。

## 次の候補

- `plan-docs`の対話を画面から進める
- `review-docs`のpacket、判定、記録、鮮度の確認を画面から扱い、指摘と対話を結び付ける
- 古くなった対話を、書き手が選んだ位置へ手動で付け直す
- pi-aiの他のプロバイダー（Claudeのサブスクリプションなど）を選べるようにする
- 参考資料にPDFなどを加える
