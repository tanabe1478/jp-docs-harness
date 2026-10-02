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

`critical`、`valuable`、`context`は、型付きメタルーブリックを導入しやすくするための簡略記法です。コンパイラは各文字列を`Simple Knowledge`として扱います。

## 契約の作り方と確認

契約は本文から独立した判定基準です。本文から逆算した契約は本文の要約になり、意味レビューは本文から抜けている内容を判定できなくなります。そのため、読者（`audience`）、読後の変化（`reader_delta`）、書き手にしか書けない情報（`evidence.author_only`）は書き手が決め、エージェントは質問して聞き取ります。要件（`requirements`）は、エージェントが書き手の答えとプリセットの観点から組み立てます。

`plan-docs`と、契約がない状態の`review-docs`は、文書の種類、読後に得てほしいこと、読者、書き手にしか書けない情報をAskUserQuestionで一度に質問します。組み立てた契約の要約を示し、書き手が確定した場合だけ確認を記録します。

```console
jp-docs-harness contract docs/design.md
jp-docs-harness confirm docs/design.md
```

`contract`は要約と確認状態を表示し、`confirm`は確認を記録します。本文がまだなくても使えます。確認は`.jp-docs-harness/contracts/<Markdownのパス>.confirmation.json`へ契約の内容ハッシュと一緒に保存されます。確認後に契約を書き換えると、状態は`確認後に変更`になります。

| 状態 | 意味 |
| --- | --- |
| `confirmed` | 書き手が現在の契約を確認した |
| `unconfirmed` | 確認の記録がない |
| `changed` | 確認後に契約が変更された |

エージェントの判断で`confirm`を実行することは手順で禁じていますが、CLIの実行そのものは技術的に防げません。piでは、利用者が`/confirm-contract`を実行し、確認ダイアログで承認した場合だけ記録します。

## プリセット

`preset`には、契約を作るときに要件の観点を借りた文書種別を記録します。プリセットは`presets/`に同梱しています。

| preset | 用途 | profile |
| --- | --- | --- |
| `meeting-notes` | 会議・1on1の記録と振り返り | `reference` |
| `decision-proposal` | 設計・方針の提案 | `decision-proposal` |
| `technical-explainer` | 技術解説・調査結果 | `technical-explainer` |
| `tutorial` | 手順書・導入ガイド | `tutorial` |

各プリセットは、種類ごとの定石の観点（`requirements`）と、読後の変化や書き手にしか書けない情報の候補（`reader_delta_hints`、`author_only_hints`）を持ちます。観点はそのまま要件にせず、書き手の答えを使って文書向けに具体化します。契約はプリセットを参照せず自己完結するため、プリセットを更新しても既存の契約は変わりません。

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

型付き要件は、固定規則で自己完結したチェックへ変換されます。Strict Listは項目ごとのチェック、Flexible Listは最低網羅率と追加項目のチェック、Processは各手順の存在と順序のチェックへ変換されます。

## 根拠資料と要件を結び付ける

`evidence.sources`へ根拠資料を宣言し、型付き要件の`source_ids`から参照できます。

```yaml
evidence:
  sources:
    - id: benchmark
      path: evidence/benchmark.txt
      description: リリース前の測定結果
    - id: public-spec
      url: https://example.com/spec

requirements:
  - id: latency
    importance: answer-critical
    type: simple-knowledge
    description: 応答性能
    fact: p95の応答時間は100ms以下
    source_ids: [benchmark]
```

ローカルの`path`はプロジェクト内だけを指定できます。`prepare`は1 MiB以下の資料をreview packetへ読み込み、内容のハッシュを`evidenceHash`へ反映します。資料を変更すると保存済みレビューは`stale`になります。

URLは参照先として記録しますが、決定論的なprepare処理では取得しません。明示的な`snapshot`コマンドで取得します。

```console
jp-docs-harness snapshot docs/design.md
```

取得内容は`.jp-docs-harness/evidence/`、URL、内容ハッシュ、取得時刻、HTTPメタデータは`.jp-docs-harness/evidence.lock.json`へ保存されます。以後のprepareはネットワークへ接続せず、lockと内容ハッシュを検証します。同じ内容を再取得しても`evidenceHash`は変わりません。チームやCIで同じ根拠を使う場合は、snapshotとlockの両方をバージョン管理してください。

snapshotは1 MiB以下のUTF-8テキストだけを受け入れます。localhost、private network、認証情報を含むURLを拒否し、各リダイレクト先も検査します。PDFなどのバイナリ資料は、テキストへ変換したローカルファイルを`path`で指定してください。

## 検査モード

`--review-mode`で契約の適用方法を指定します。

| モード | 現在の動作 |
| --- | --- |
| `manual` | 存在する契約を検証し、契約がない文書は許可する。確認状態は表示だけにする |
| `contracted` | 存在する契約を検証し、契約がない文書は許可する。未確認の契約は警告する |
| `strict` | すべての対象Markdownに有効な契約を要求する。未確認の契約はエラーにする |

```console
npx jp-docs-harness lint --review-mode strict docs/design.md
```

`contracted`と`strict`では、有効な文書契約がある文書に現在の本文、契約、ルーブリック、根拠資料と一致する意味レビュー結果を要求します。

## Review packetを生成する

`prepare`コマンドは、本文、契約、ハッシュ、コンパイル済みチェックを一つのJSONへまとめます。

```console
npx jp-docs-harness prepare docs/design.md > review-packet.json
```

review packetは、Claude Codeやpiが意味レビューを行う際の入力です。生成時の会話は含めず、完成稿と明示された契約だけをJudgeへ渡せます。

`evidence.author_only`はチェックへ自動変換せず、review packetの`rubric.authorOnly`へ保持します。Phase 3のAccountability gateが、人間の入力を必要とする項目として扱います。

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
