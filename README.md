# jp-docs-harness

AIと一緒に書いた日本語Markdownを、表現だけでなく、目的への適合、根拠、書き手の入力まで確認するハーネスです。

AIが書いた文章かどうかを判定するツールではありません。読者が文書から必要な理解、判断、行動を得られるかを確認し、AIが直せる問題と、書き手本人へ戻すべき問題を分けます。

Claude Code Plugin、pi package、CLIとして利用できます。導入先プロジェクトの`package.json`へ依存パッケージを追加する必要はありません。

## 二つの入口

| コマンド | 役割 | 対象 |
| --- | --- | --- |
| `check-docs` | 不自然な表現、強調の乱用、評価・感想の付け足し、契約の形式、保存済みレビューの状態を確認する | GitリポジトリまたはMarkdown |
| `review-docs` | 文書の目的、完全性、主張の根拠、書き手の入力をAIで確認する | Markdown一件 |

文書検査は明示的にコマンドを実行したときだけ動きます。Claude CodeのStop hookやpiの`agent_settled`による自動検査は行いません。作業を勝手に中断せず、複数リポジトリの親ディレクトリから起動した場合にも、意図しないリポジトリを検査しないためです。

通常は`check-docs`で仕上げを確認し、重要なREADME、設計文書、提案書には`review-docs`を使います。

対象の境界は通常Gitリポジトリです。Gitリポジトリに属さないMarkdownも1件単位で指定でき、その場合はファイルのあるディレクトリを境界として、文書契約と`.jp-docs-harness/`を文書の隣に配置します。ディレクトリ全体の検査にはGitリポジトリが必要です。

## Claude Codeで試す

マーケットプレイスを追加し、Pluginをインストールします。

```text
/plugin marketplace add tanabe1478/jp-docs-harness
/plugin install jp-docs-harness@jp-docs-harness-marketplace
/reload-plugins
```

リポジトリ全体を軽量検査します。

```text
/jp-docs-harness:check-docs /path/to/repository
```

Markdown一件だけを検査することもできます。

```text
/jp-docs-harness:check-docs docs/design.md
```

文書の内容までレビューする場合は次のコマンドを使用します。

```text
/jp-docs-harness:review-docs docs/design.md
```

対象を省略し、現在の依頼で編集したMarkdownが一件に絞れる場合は、その文書を使用します。複数候補がある場合だけ選択を求めます。

ローカルのリポジトリをPluginとして試すこともできます。

```console
claude --plugin-dir /path/to/jp-docs-harness
```

初回起動時と依存関係の更新時には、Plugin専用の永続データディレクトリへ依存パッケージをインストールします。導入先プロジェクトの`package.json`は変更しません。

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
/check-docs /path/to/repository
/review-docs docs/design.md
```

`check-docs`の対象を省略した場合、現在の作業ディレクトリが一つのGitリポジトリに属していれば、そのリポジトリを使います。複数リポジトリの親ディレクトリなど、対象を決められない場合は入力欄を表示します。

`review-docs`の対象を省略した場合も、Markdownのパスを入力できます。

従来の`/lint-docs`は`/check-docs`の互換名として利用できます。

## 検査結果の読み方

人間向けの結果は重要度ごとにまとまり、次に誰が対応すべきかを表示します。

```text
Markdown 1件を検査しました: エラー 1件、警告 2件
意味レビュー: 未実行 1件（重要文書にはreview-docsを使用）

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
- `[手作業で修正]`: 構成の入れ替えなど、自動修正では文意を保てません
- `[要確認]`: 資料だけでは判断できないため、不確実性を残します

`意味レビュー`の行は、保存済みレビューが本文、契約、根拠資料に対して最新かを示します。`未実行`でも軽量検査の失敗ではありませんが、文書の目的や根拠までは確認されていません。

表現上の警告だけでは、既定でCLIを失敗扱いにしません。契約違反などのエラーがある場合だけ終了コード1を返します。

## 意味レビューと文書契約

意味レビューには、対象文書の目的と読者を表す文書契約を使用します。`docs/design.md`に対する契約は`docs/design.md.intent.yml`です。

`review-docs`の初回実行時に契約がなければ、エージェントが現在の依頼と本文から最小構成を作ります。目的を合理的に決められない場合だけ、利用者へ一つの質問を返します。

作成される契約は、たとえば次のようになります。

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
    - 自動実行しない理由
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

問題がなければ成功メッセージと意味レビューの状態を表示します。

```text
Markdown 2件を検査しました。問題はありません。
意味レビュー: 最新 1件、未実行 1件（重要文書にはreview-docsを使用）
```

機械処理にはJSON出力を使用できます。

```console
jp-docs-harness check --format json README.md
```

すべての対象文書へ文書契約を要求する場合は`strict`モードを指定します。

```console
jp-docs-harness check --review-mode strict docs/design.md
```

表現上の警告も許さない場合は、`--fail-on warning`で終了コード1にする重要度を上げられます。CIで文体を揃えたい場合に使用します。

```console
jp-docs-harness check --fail-on warning README.md
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

textlintの設定は[`.textlintrc.json`](./.textlintrc.json)、Claude CodeのPlugin設定は[`.claude-plugin/plugin.json`](./.claude-plugin/plugin.json)、piの統合は[`extensions/textlint-on-settle.ts`](./extensions/textlint-on-settle.ts)にあります。
