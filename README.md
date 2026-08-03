# jp-docs-harness

AIが生成する日本語Markdownをtextlintで検査するハーネスです。
AIが生成しがちな不自然な構造や表現を検出する`@textlint-ja/textlint-rule-preset-ai-writing`を使用します。

Claude Code Pluginとpi packageの両方として配布できるため、導入先の各プロジェクトへ設定ファイルをコピーする必要はありません。

今後の製品構想とロードマップは、[`docs/product-plan.md`](./docs/product-plan.md)にまとめています。完全性評価へ応用するGAMUT論文の調査結果は、[`docs/research/gamut.md`](./docs/research/gamut.md)にあります。文書契約は[`docs/document-contract.md`](./docs/document-contract.md)、レビュー結果とGroundingは[`docs/semantic-review.md`](./docs/semantic-review.md)、Judge比較は[`docs/evaluation.md`](./docs/evaluation.md)を参照してください。

## このリポジトリを開発する

Node.jsのバージョンはmiseで管理します。

```console
mise install
mise run setup
mise run lint
```

ルールの設定は[`.textlintrc.json`](./.textlintrc.json)で管理します。

## Claude Code Plugin

ローカルで試す場合は、このリポジトリをPluginとして指定します。

```console
claude --plugin-dir /path/to/jp-docs-harness
```

継続して利用する場合は、リポジトリをマーケットプレイスとして追加してPluginをインストールします。

```text
/plugin marketplace add tanabe1478/jp-docs-harness
/plugin install jp-docs-harness@jp-docs-harness-marketplace
/reload-plugins
```

ユーザースコープでインストールすれば、Claude Codeを使用する複数のプロジェクトで有効になります。

手動検査には、名前空間付きスラッシュコマンドを使用します。

```text
/jp-docs-harness:lint-docs /path/to/repository
/jp-docs-harness:lint-docs docs/design.md
```

Claude Codeを複数リポジトリの親ディレクトリから起動した場合は、対象リポジトリまたはMarkdownを明示してください。

文書検査は手動コマンドを実行したときだけ行います。Stop hookによる自動検査は無効です。初回起動時と依存関係の更新時には、Plugin専用の永続データディレクトリへ依存パッケージをインストールします。導入先プロジェクトの`package.json`は変更しません。

Pluginの構成要素は次の場所にあります。

- [`.claude-plugin/plugin.json`](./.claude-plugin/plugin.json)
- [`.claude-plugin/marketplace.json`](./.claude-plugin/marketplace.json)
- [`skills/lint-docs/SKILL.md`](./skills/lint-docs/SKILL.md)
- [`hooks/hooks.json`](./hooks/hooks.json)

## pi package

ローカルパスからユーザースコープへインストールすると、複数のプロジェクトで利用できます。

```console
pi install /path/to/jp-docs-harness
```

Gitで公開した後は、Git URLからインストールできます。

```console
pi install git:github.com/tanabe1478/jp-docs-harness
```

piでは次のスラッシュコマンドを使用します。

```text
/lint-docs <repository-or-Markdown>
```

`agent_settled`による自動検査と、ファイル変更の自動追跡は無効です。文書検査は手動コマンドを実行したときだけ行います。

pi packageの依存関係はインストール時に自動で導入されます。導入先プロジェクトにNode.jsパッケージを追加する必要はありません。

## CLI

npmパッケージとして公開した後は、AIエージェントを使わずに検査できます。

```console
npx jp-docs-harness
```

特定のMarkdownだけを検査する場合は、ファイルパスを指定します。

```console
npx jp-docs-harness README.md docs/design.md
```

他のツールから結果を利用する場合は、共通finding形式のJSONを出力できます。

```console
npx jp-docs-harness lint --format json README.md
```

すべての対象文書へ文書契約を要求する場合は、`strict`モードを指定します。

```console
npx jp-docs-harness lint --review-mode strict docs/design.md
```

有効な文書契約から意味レビュー用のreview packetを生成できます。

```console
npx jp-docs-harness snapshot docs/design.md
npx jp-docs-harness prepare docs/design.md > review-packet.json
```

意味レビューの結果を検証して保存し、本文や契約の変更後に鮮度を確認できます。

```console
npx jp-docs-harness record review-packet.json review-result.json
npx jp-docs-harness verify docs/design.md
npx jp-docs-harness eval gold.json candidate.json
npx jp-docs-harness eval-prepare .jp-docs-harness/eval-runs/current
npx jp-docs-harness eval-suite .jp-docs-harness/eval-runs/current
npx jp-docs-harness eval-diff baseline-report.json candidate-report.json
```

Claude Codeとpiから意味レビューを実行できます。

```text
# Claude Code
/jp-docs-harness:review-docs docs/design.md

# pi
/review-docs docs/design.md

# Judge回帰評価
/jp-docs-harness:eval-harness .jp-docs-harness/eval-runs/current
/eval-harness .jp-docs-harness/eval-runs/current
```
