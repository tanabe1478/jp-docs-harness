# 文書契約の利用方法

文書契約は、Markdownの目的、読者、必須内容を検査前に定義するsidecarファイルです。

## ファイル名

対象Markdownのパスへ`.intent.yml`を加えます。

| Markdown | 文書契約 |
| --- | --- |
| `README.md` | `README.md.intent.yml` |
| `docs/design.md` | `docs/design.md.intent.yml` |

## 最小構成

```yaml
version: 1
profile: technical-explainer

audience:
  knows:
    - textlintの基本的な使い方
  problem:
    - 文書が目的を満たすか判断できない

reader_delta:
  know:
    - ハーネスが検査する内容
  decide:
    - 自分のプロジェクトへ導入するか
  do:
    - 手動検査を実行する

requirements:
  critical:
    - インストール方法
    - 手動検査の実行方法
  valuable:
    - 自動検査の実行タイミング
  context:
    - 開発環境の構成
```

`critical`、`valuable`、`context`は、型付きメタルーブリックを導入しやすくするための簡略記法です。各文字列を`Simple Knowledge`として扱うコンパイラは、次の実装単位で追加します。

## 型付き要件

GAMUTを参考にした型付き要件もSchemaで定義しています。

```yaml
version: 1
profile: tutorial

audience:
  problem: Pluginの導入順序が分からない

reader_delta:
  know:
    - Pluginを構成する要素
  decide:
    - Pluginを導入するか
  do:
    - Pluginをインストールする

requirements:
  - id: installation-flow
    importance: answer-critical
    type: process
    description: Claude Code Pluginの導入手順
    ordered_steps:
      - text: marketplaceを追加する
        mandatory: true
      - text: Pluginをインストールする
        mandatory: true
      - text: Pluginを再読み込みする
        mandatory: true
```

利用できる型は次の通りです。

| 型 | 必須フィールド |
| --- | --- |
| `simple-knowledge` | `fact` |
| `strict-list` | `items` |
| `flexible-list` | `items`、`baseline` |
| `process` | `ordered_steps` |
| `relationship` | `entities`、`aspects` |

型付き要件から独立したチェックを生成する処理は未実装です。現在は契約の構文、Schema、ハッシュだけを検査します。

## 検査モード

`--review-mode`で契約の適用方法を指定します。

| モード | 現在の動作 |
| --- | --- |
| `manual` | 存在する契約を検証し、契約がない文書は許可する |
| `contracted` | 存在する契約を検証し、契約がない文書は許可する |
| `strict` | すべての対象Markdownに有効な契約を要求する |

```console
npx jp-docs-harness lint --review-mode strict docs/design.md
```

`contracted`は、意味検査を実装した後に、契約がある文書だけを自動レビューするモードになります。現時点では`manual`と同じ契約検証を行います。

## JSON出力

JSONレポートの各文書には、契約の状態とハッシュが含まれます。

```json
{
  "path": "docs/design.md",
  "contentHash": "sha256:...",
  "contract": {
    "path": "docs/design.md.intent.yml",
    "status": "valid",
    "contractHash": "sha256:..."
  }
}
```

`contractHash`は、保存済みレビューが現在の契約に対して有効か判定するFreshness gateで使用します。
