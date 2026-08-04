---
description: Markdownの目的、完全性、根拠、書き手の入力を意味レビューします。
argument-hint: "[Markdownファイル]"
disable-model-invocation: true
---

## 対象とリポジトリを決める

`$ARGUMENTS`にMarkdownファイルが指定されていれば、それを対象にしてください。

指定がない場合は、現在の依頼で作成または編集したMarkdownが一件だけなら、そのファイルを対象にしてください。複数あり、依頼内容から一件へ絞れない場合だけ、候補を示して利用者へ選択を求めてください。過去の会話だけを根拠に無関係なファイルを選んではいけません。

対象ファイルの属するGitリポジトリを`git rev-parse --show-toplevel`で特定してください。以降の`<REPO_ROOT>`はその絶対パス、`<TARGET>`はリポジトリルートからのMarkdownパスへ置き換えます。

対象がGitリポジトリに属さない場合は、ファイルのあるディレクトリを`<REPO_ROOT>`、ファイル名を`<TARGET>`として続行してください。文書契約とレビュー結果はそのディレクトリへ保存されるため、最後の報告で保存場所を明示してください。

## 文書契約を用意する

対象本文を読み、`<REPO_ROOT>/<TARGET>.intent.yml`を確認してください。

契約がない場合は、現在の利用者の依頼と本文から次を抽出し、最小限の契約を作成してください。

- 想定読者と、読者が困っていること
- 読後に理解、判断、実行できるようにしたいこと
- 文書の目的に欠かせない内容
- あると価値が上がる内容
- 明示された非目標

目的を合理的に特定できる場合は確認を挟まず作成し、最後の報告で採用した前提を短く示してください。目的によって評価基準が大きく変わる場合だけ、一つの簡潔な質問をしてください。

作成した契約は下書きです。作成したパスと、利用者が内容を確認して修正または削除できることを報告してください。

契約には本文や依頼から確認できる情報だけを書いてください。書き手の経験、動機、判断理由を推測して`evidence.author_only`へ追加してはいけません。根拠資料も、実在を確認できるパスまたは利用者が示したURLだけを追加してください。

最初は簡略形式で構いません。

```yaml
version: 1
profile: technical-explainer

audience:
  knows: []
  problem:
    - 読者が解決したい問題

reader_delta:
  know:
    - 読後に理解できること
  decide: []
  do: []

requirements:
  critical:
    - 目的達成に欠かせない内容
  valuable: []
  context: []
```

既存の契約がある場合は、その内容を利用者の新しい依頼で勝手に置き換えないでください。本文との明白な不整合やSchema違反だけを修正し、意味が変わる場合は利用者へ確認してください。

## Review packet

`${CLAUDE_PLUGIN_ROOT}`がシェルで未設定の場合は、このスキルのベースディレクトリの二階層上（プラグインルート）の絶対パスへ読み替えてください。環境変数を手動で設定する必要はありません。

リポジトリルートで作業用ディレクトリを作り、review packetを生成してください。

```console
cd "<REPO_ROOT>"
mkdir -p .jp-docs-harness/work
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" prepare "<TARGET>" > .jp-docs-harness/work/review-packet.json
```

生成に失敗した場合は、エラーを読んで契約の形式や参照パスを修正してください。文書の目的や根拠を創作して通してはいけません。

`sourcePolicy: required`で参照されるURL資料が`external`、`missing-snapshot`、`invalid-snapshot`の場合は、ネットワーク取得を行う前に利用者へ許可を求めてください。許可された場合だけ次を実行し、review packetを再生成します。

```console
cd "<REPO_ROOT>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" snapshot "<TARGET>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" prepare "<TARGET>" > .jp-docs-harness/work/review-packet.json
```

ローカル資料が`missing`の場合は内容を創作せず、利用者へ資料の提供を求めてください。

## 判定

review packetだけを判定材料として使用してください。本文生成時の会話や、packetに含まれない知識を判定根拠にしてはいけません。

`rubric.checks`を一件ずつ独立して評価し、すべてのcheck IDについて次を返してください。

- `meets`: 要件を正しく満たす
- `partially_meets`: 方向は正しいが具体性または網羅性が不足する
- `missing`: 必要な内容がない
- `contradicts`: 読者を誤らせる実質的な矛盾がある

指摘には本文の行範囲を付けてください。本文に根拠箇所がない`missing`は`location: null`とします。

`rubric.authorOnly`も全件評価してください。本文と許可された根拠に情報がなければ`missing`とし、推測で`provided`にしてはいけません。

本文中の外部検証可能な事実、推奨、書き手固有の経験を主張単位で抽出し、`claimEvaluations`へ記録してください。検証可能な主張を確認した場合は`groundingCoverage.status`を`reviewed`にします。該当する主張が本当にない場合だけ`no_verifiable_claims`とし、理由を書きます。本文の主張は`text`へ原文のままコピーし、`location`を付けます。

`grounding.sources`のうち`status: loaded`の資料だけを根拠として引用でき、引用には資料の行範囲が必要です。根拠がない主張は`unsupported`、一部だけ裏付けられる場合は`partially_supported`、資料と矛盾する場合は`conflicts`です。URLだけの資料や欠落した資料を読んだことにしてはいけません。

`sourcePolicy: required`のチェックを`meets`、`partially_meets`、`contradicts`にする場合は、そのチェックの`claimIds`から指定された全`sourceIds`の引用へ到達できるようにしてください。根拠不要または`missing`のチェックでは`claimIds`を空配列にできます。書き手固有の経験を裏付けられない場合は`needs_author`とし、AIによる修正を不可にしてください。

結果を[`schemas/review-result.schema.json`](${CLAUDE_PLUGIN_ROOT}/schemas/review-result.schema.json)に適合するJSONとして、`<REPO_ROOT>/.jp-docs-harness/work/review-result.json`へ保存してください。`document`、`contract`、`rubricHash`、`evidenceHash`はreview packetからそのままコピーします。`judge`には現在のproviderとmodelが分かる場合は記録し、分からない場合は`current-agent`とします。`promptVersion`は`2`です。

## 記録と確認

結果を検証して記録します。

```console
cd "<REPO_ROOT>"
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" record .jp-docs-harness/work/review-packet.json .jp-docs-harness/work/review-result.json
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" verify "<TARGET>"
```

`record`が拒否した結果を、チェックの削除やハッシュの書き換えで通してはいけません。判定漏れ、未知のID、行番号を修正して再実行してください。

## 修正と報告

`resolution: agent`かつ`repairableByAgent: true`の指摘だけを修正できます。`needs_author`は本文を変更せず、必要な入力を利用者へ質問してください。`uncertain`は断定へ変えず、不確実な理由を伝えてください。

本文を修正した場合、review packetと結果は古くなります。修正後にprepare、判定、record、verifyを一度だけやり直してください。二回目にも問題が残る場合は自動修正を繰り返さず、未解決の指摘を利用者へ返してください。

最後に、対象文書、契約を新規作成したか、修正内容、書き手の入力が必要な項目、未解決の不確実性、保存したレビュー結果の場所を簡潔に報告してください。
