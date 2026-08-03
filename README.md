# jp-docs-harness

AIと一緒に書いた日本語Markdownを、表現だけでなく、目的への適合、根拠、書き手の入力まで確認するハーネスです。

AIが書いた文章かどうかを判定するツールではありません。読者が文書から必要な理解、判断、行動を得られるかを確認し、AIが直せる問題と、書き手本人へ戻すべき問題を分けます。

Claude Code Plugin、pi package、CLIとして利用できます。導入先プロジェクトの`package.json`へ依存パッケージを追加する必要はありません。

## 二つの使い方

| 使い方 | 役割 | 実行コスト |
| --- | --- | --- |
| `check-docs` | 不自然な表現、契約の形式、保存済みレビューの状態を確認する | 軽い |
| `review-docs` | 文書の目的、完全性、主張の根拠、書き手の入力をAIで確認する | 重い |

通常は自動の軽量検査に任せ、重要なREADME、設計文書、提案書を仕上げるときに意味レビューを実行します。

## Claude Codeで試す

マーケットプレイスを追加し、Pluginをインストールします。

```text
/plugin marketplace add tanabe1478/jp-docs-harness
/plugin install jp-docs-harness@jp-docs-harness-marketplace
/reload-plugins
```

インストール後は、Claude CodeにMarkdownを書かせるだけで軽量検査が動きます。現在のターンで作成または編集したMarkdownだけを、応答終了時にまとめて確認します。

明示的に検査する場合は次のコマンドを使用します。

```text
/jp-docs-harness:check-docs README.md
```

文書の内容までレビューする場合は次のコマンドを使用します。

```text
/jp-docs-harness:review-docs README.md
```

対象を省略した場合、現在の依頼で編集したMarkdownが一件に絞れるときは、その文書を使用します。複数の候補がある場合だけ対象の指定を求めます。

ローカルのリポジトリをPluginとして試すこともできます。

```console
claude --plugin-dir /path/to/jp-docs-harness
```

## piで試す

Gitリポジトリからユーザースコープへインストールします。

```console
pi install git:github.com/tanabe1478/jp-docs-harness
```

ローカルの変更を試す場合は、パスを指定します。

```console
pi install /path/to/jp-docs-harness
```

軽量検査と意味レビューの入口は次の二つです。

```text
/check-docs README.md
/review-docs README.md
```

piはMarkdownへの`write`または`edit`を記録し、エージェントの処理が落ち着いた時点で、変更された文書だけを一度検査します。修正が必要なエラーは一度だけエージェントへ返します。警告だけの場合は新しい修正ターンを開始しません。

従来の`/lint-docs`も互換名として利用できます。

## 検査結果の読み方

人間向けの結果は重要度ごとにまとまり、次に誰が対応すべきかを表示します。

```text
Markdown 1件を検査しました: エラー 1件、警告 2件

エラー 1件
  docs/design.md 文書の目的に必要な説明がありません (...) [AIで修正可能]

警告 2件
  docs/design.md:18:1 説明が一般的すぎます (...) [AIで修正可能]
  docs/design.md 書き手の判断理由を確認できません (...) [書き手に確認]

対応の目安
  AIで修正できる指摘: 2件
  書き手の入力が必要な指摘: 1件
```

表示の意味は次の通りです。

- `[AIで修正可能]`: 文意を保てる範囲でエージェントが修正できます
- `[書き手に確認]`: 経験、動機、判断などをAIが推測せず、利用者へ質問します
- `[要確認]`: 資料だけでは判断できないため、不確実性を残します

表現上の警告だけではCLIやフックを失敗扱いにしません。契約違反や目的達成を妨げるエラーがある場合だけ、終了コード1または修正ターンを使用します。

## 意味レビューと文書契約

意味レビューには、対象文書の目的と読者を表す文書契約を使用します。`docs/design.md`に対する契約は`docs/design.md.intent.yml`です。

`review-docs`の初回実行時に契約がなければ、エージェントが現在の依頼と本文から最小構成を作ります。目的を合理的に決められない場合だけ、利用者へ一つの質問を返します。

作成された契約は、たとえば次のようになります。

```yaml
version: 1
profile: technical-explainer

audience:
  knows: []
  problem:
    - 導入方法と制約が分からない

reader_delta:
  know:
    - ツールが検査する内容
  decide:
    - 自分のプロジェクトへ導入するか
  do:
    - 手動検査を実行する

requirements:
  critical:
    - インストール方法
    - 検査結果への対応方法
  valuable:
    - 自動検査が動くタイミング
  context: []
```

契約は次回以降のレビューにも使われます。エージェントは書き手固有の経験や判断を契約へ勝手に追加せず、必要な場合は`needs_author`として返します。

レビュー結果は次の場所へ保存されます。

```text
.jp-docs-harness/reviews/<Markdownのパス>.review.json
```

本文、契約、根拠資料のいずれかが変わると、保存済みレビューは古いものとして検出されます。

## CLI

CLIでは`check`が既定のコマンドです。コマンド名を省略しても構いません。

```console
jp-docs-harness README.md
jp-docs-harness check README.md docs/design.md
```

問題がなければ成功メッセージを表示します。

```text
Markdown 2件を検査しました。問題はありません。
```

機械処理にはJSON出力を使用できます。

```console
jp-docs-harness check --format json README.md
```

すべての対象文書へ文書契約を要求する場合は`strict`モードを指定します。

```console
jp-docs-harness check --review-mode strict docs/design.md
```

`lint`は`check`の互換名です。`prepare`、`snapshot`、`record`は意味レビューの内部処理として残していますが、Claude Codeやpiの利用者が通常直接実行する必要はありません。

## 生成されるファイル

| パス | 用途 | 推奨する扱い |
| --- | --- | --- |
| `*.md.intent.yml` | 文書の目的、読者、必須内容 | 文書と一緒にレビューする |
| `.jp-docs-harness/reviews/` | 検証済みの意味レビュー結果 | チームやCIで共有する場合は管理対象にする |
| `.jp-docs-harness/evidence/` | URL根拠資料の再現可能なsnapshot | 根拠を共有する場合はlockと一緒に管理する |
| `.jp-docs-harness/work/` | 一時的なreview packetと結果 | Gitへ追加しない |

## 詳細資料

- [文書契約の形式と検査モード](./docs/document-contract.md)
- [意味レビュー、Grounding、結果の鮮度](./docs/semantic-review.md)
- [Judgeの回帰評価](./docs/evaluation.md)
- [製品構想とロードマップ](./docs/product-plan.md)
- [GAMUT論文から取り入れた設計](./docs/research/gamut.md)

## 開発

Node.jsのバージョンはmiseで管理します。

```console
mise install
mise run setup
npm test
mise run lint
npm run pack:check
```

textlintの設定は[`.textlintrc.json`](./.textlintrc.json)、Claude Codeのフックは[`hooks/hooks.json`](./hooks/hooks.json)、piの統合は[`extensions/textlint-on-settle.ts`](./extensions/textlint-on-settle.ts)にあります。
