---
description: 文書契約に基づいてMarkdownの完全性と書き手入力を検査します。
argument-hint: "<Markdownファイル>"
disable-model-invocation: true
---

対象は`$ARGUMENTS`です。対象が空の場合は、ファイルを推測せず利用者へ指定を求めてください。

## Review packet

作業用ディレクトリを作り、review packetを生成してください。

```console
mkdir -p "${CLAUDE_PROJECT_DIR}/.jp-docs-harness/work"
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" prepare "$ARGUMENTS" > "${CLAUDE_PROJECT_DIR}/.jp-docs-harness/work/review-packet.json"
```

生成に失敗した場合は、文書や契約を推測で補わず、エラーを利用者へ伝えてください。

`sourcePolicy: required`で参照されるURL資料が`external`、`missing-snapshot`、`invalid-snapshot`の場合は、ネットワーク取得を行う前に利用者へ許可を求めてください。許可された場合だけ次を実行し、review packetを再生成します。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" snapshot "$ARGUMENTS"
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" prepare "$ARGUMENTS" > "${CLAUDE_PROJECT_DIR}/.jp-docs-harness/work/review-packet.json"
```

ローカル資料が`missing`の場合は内容を創作せず、利用者へ資料の提供を求めてください。

## 判定

review packetだけを判定材料として使用してください。生成時の会話や、本文に書かれていない知識を根拠にしてはいけません。

`rubric.checks`を一件ずつ独立して評価し、すべてのcheck IDについて次を返してください。

- `meets`: 要件を正しく満たす
- `partially_meets`: 方向は正しいが具体性または網羅性が不足する
- `missing`: 必要な内容がない
- `contradicts`: 読者を誤らせる実質的な矛盾がある

指摘には本文の行範囲を付けてください。本文に根拠箇所がない`missing`は`location: null`とします。

`rubric.authorOnly`も全件評価してください。本文と許可された根拠に情報がなければ`missing`とし、推測で`provided`にしてはいけません。

本文中の外部検証可能な事実、推奨、書き手固有の経験を主張単位で抽出し、`claimEvaluations`へ記録してください。検証可能な主張を確認した場合は`groundingCoverage.status`を`reviewed`にします。該当する主張が本当にない場合だけ`no_verifiable_claims`とし、理由を書きます。本文の主張は`text`へ原文のままコピーし、`location`を付けます。`grounding.sources`のうち`status: loaded`の資料だけを根拠として引用でき、引用には資料の行範囲が必要です。根拠がない主張は`unsupported`、一部だけ裏付けられる場合は`partially_supported`、資料と矛盾する場合は`conflicts`です。URLだけの資料や欠落した資料を読んだことにしてはいけません。`sourcePolicy: required`のチェックを`meets`、`partially_meets`、`contradicts`にする場合は、そのチェックの`claimIds`から指定された全`sourceIds`の引用へ到達できるようにしてください。根拠不要または`missing`のチェックでは`claimIds`を空配列にできます。書き手固有の経験を裏付けられない場合は`needs_author`とし、AIによる修正を不可にしてください。

結果を[`schemas/review-result.schema.json`](${CLAUDE_PLUGIN_ROOT}/schemas/review-result.schema.json)に適合するJSONとして、`${CLAUDE_PROJECT_DIR}/.jp-docs-harness/work/review-result.json`へ保存してください。`document`、`contract`、`rubricHash`、`evidenceHash`はreview packetからそのままコピーします。`judge`には現在のproviderとmodelが分かる場合は記録し、分からない場合は`current-agent`とします。`promptVersion`は`2`です。

## 記録と確認

結果を検証して記録します。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" record ".jp-docs-harness/work/review-packet.json" ".jp-docs-harness/work/review-result.json"
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" verify "$ARGUMENTS"
```

`record`が拒否した結果を、チェックの削除やハッシュの書き換えで通してはいけません。判定漏れ、未知のID、行番号を修正して再実行してください。

## 修正方針

`resolution: agent`かつ`repairableByAgent: true`の指摘だけを修正できます。`needs_author`は本文を変更せず、必要な入力を利用者へ質問してください。`uncertain`は断定へ変えず、不確実な理由を伝えてください。

本文を修正した場合、review packetと結果は古くなります。修正後にprepare、判定、record、verifyを一度だけやり直してください。二回目にも問題が残る場合は自動修正を繰り返さず、未解決の指摘を利用者へ返してください。
