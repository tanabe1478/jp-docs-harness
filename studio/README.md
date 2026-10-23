# jp-docs Studio

AIと対話しながら、自分の考えを確かめて書くためのローカルの執筆環境です。原稿はworkspace内のMarkdownをそのまま編集します。選んだ箇所についてAIに「どう読める？」「別の見方は？」と尋ね、返答・保留・却下・気づきの記録を残せます。AIの修正案は差分を見て採用した場合だけ原稿に反映します。

AIは入力中にも保存時にも呼び出しません。呼ぶのは、選択箇所のボタンか対話パネルのボタンを押したときだけです。

jp-docs-harness本体（CLI、pi package、Claude Code Plugin）とは依存関係を分けています。Studioは本体の`bin/jp-docs-harness.mjs`を子プロセスとして呼ぶだけで、本体からStudioは参照しません。

## 必要なもの

- Node.js 22.18以降（サーバーのTypeScriptをNodeの型除去で直接実行するため）
- 検査を使う場合は、リポジトリのルートで`npm install`を済ませておく

## 起動

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

`--workspace`には絶対パスを指定します。Studioが読み書きするのはその配下のMarkdown（`.md`、`.markdown`）だけです。

## AIの設定

AIを使う場合は、サーバーを起動する前に次の環境変数を設定します。設定しなくても、執筆・保存・検査は使えます。その場合、AIのボタンは設定が必要であることだけを表示し、回答らしきものは出しません。

| 環境変数 | 内容 |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI APIのキー |
| `JP_DOCS_STUDIO_MODEL` | 使用するモデル名（必須。既定値はありません） |

OpenAI APIの利用料は、ChatGPTの有料プランとは別に課金されます。

APIキーはサーバーの環境変数からだけ読みます。ブラウザ、ログ、保存する対話データには書き込みません。

AIへ送るのは次の範囲だけです。原稿全体は送りません。

- 選択した文
- 選択箇所を含む段落の前後1段落（前後それぞれ最大2000字）
- その対話の直近8件の発言

Responses APIへは`store: false`を指定して送ります。

## 保存先と削除

原稿はworkspace内のMarkdownファイルです。対話・気づき・修正案の記録はworkspaceの外に、workspaceの実体パスのハッシュごとに保存します。

| OS | 保存先 |
| --- | --- |
| macOS | `~/Library/Application Support/jp-docs-studio/workspaces/<hash>/studio.json` |
| Windows | `%APPDATA%\jp-docs-studio\workspaces\<hash>\studio.json` |
| Linux | `$XDG_DATA_HOME/jp-docs-studio/...`（未設定なら`~/.local/share/jp-docs-studio/...`） |

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
npm run test:e2e       # 画面をビルドし、Playwright（Chromium）で主要フローを確認する
npm run typecheck      # 型検査
npm run test:ai-smoke  # 実際のOpenAI APIで1往復する（キーがある場合だけ。課金が発生します）
```

テストのAIは`tests/fixtures/fake-adapter.ts`の偽物を使います。偽物は`tests/e2e/server.ts`からだけ読み込み、通常の起動には含めません。E2Eは`test-results/screenshots/`へFocus、Discuss、Proposal、狭い画面の画像を保存します。

Studioのテストファイルは`*.spec.ts`と`*.e2e.ts`です。リポジトリのルートの`npm test`（`node --test`）は`*.test.ts`も拾うため、名前を分けてルートのテストとして実行されないようにしています。

## 構成

| パス | 役割 |
| --- | --- |
| `src/server/security/` | workspaceのパス検証、Host・Origin・独自ヘッダーの検査、CSP |
| `src/server/services/` | 原稿、対話と修正案、AIへ送る文脈の切り出し、既存CLIの呼び出し |
| `src/server/providers/` | `AiAdapter`とOpenAIの実装、指示文 |
| `src/server/persistence/` | 対話データの保存先と、一時ファイルを経由した書き込み |
| `src/client/` | React、CodeMirror 6の画面 |
| `docs/handoff/` | 受け取った実装指示書、画面仕様、デザイン資料（原文のまま） |

## 制限と未確認の事項

- 実際のOpenAI APIでの動作は、この実装の時点では確認していません。キーのある環境で`npm run test:ai-smoke`を実行してください。
- Windowsでの起動は確認していません。パスの検証はWindows形式の入力も扱うよう実装し、ユニットテストで確かめています。
- E2EはChromiumだけで実行しています。IMEの変換はChromiumの開発者向けプロトコルで再現したもので、実際のOSのIMEでは確認していません。
- workspaceを移動すると保存先のハッシュが変わり、それまでの対話は表示されません。
- 原稿のどこかを編集すると、その原稿の対話はすべて古い位置として扱います。
- 改行コードが混在するファイルは、開いたときに多い方へ揃え、保存時にその形で書き込みます。
- 開発モード（`npm run dev`）では、ViteのHMRのためにCSPの`script-src`と`connect-src`を緩めています。
- 画面はMarkdownのソースをそのまま表示します。見出しの記号なども表示されます。

## 次の候補

- `plan-docs`の対話を画面から進める
- `review-docs`のpacket、判定、記録、鮮度の確認を画面から扱い、指摘と対話を結び付ける
- 古くなった対話を、書き手が選んだ位置へ手動で付け直す
- OpenAI以外の`AiAdapter`（piやClaudeなどの実行器）
