---
description: 日本語Markdownの意味レビュー。利用者が文書のレビュー、内容や構成の確認、目的に合っているかの確認、根拠の確認を依頼したときに使用します。Markdown一件を対象に、文書契約に基づいて目的への適合、完全性、主張の根拠、書き手の入力の要否をレビューします。表現だけの軽い検査にはcheck-docsを使用します。
argument-hint: "[Markdownファイル]"
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

`grounding.sources`のうち`status: loaded`の資料だけを根拠として引用でき、引用には資料の行範囲が必要です。根拠がない主張は`unsupported`、一部だけ裏付けられる場合は`partially_supported`、資料と矛盾する場合は`conflicts`です。弱い形でなら裏付けられる内容を強く言い切っている主張も、言い切った強さの分だけ根拠が足りないため`partially_supported`にしてください。URLだけの資料や欠落した資料を読んだことにしてはいけません。

`sourcePolicy: required`のチェックを`meets`、`partially_meets`、`contradicts`にする場合は、そのチェックの`claimIds`から指定された全`sourceIds`の引用へ到達できるようにしてください。根拠不要または`missing`のチェックでは`claimIds`を空配列にできます。書き手固有の経験を裏付けられない場合は`needs_author`とし、AIによる修正を不可にしてください。

## 余分な記述

本文を一文ずつ読み、読者の知識を更新しない記述を`excessEvaluations`へ記録してください。基準は文書契約です。読後に得てほしい理解・判断・行動（`contract.readerDelta`）と要件（`rubric`）に照らし、削っても読者が得る内容が変わらない記述だけを挙げます。

種類は次の四つです。

| kind | 対象 | 必須の参照 |
| --- | --- | --- |
| `restatement` | 本文で既に述べた主張を言い直している文 | 先行箇所の`relatedText`と`relatedLocation` |
| `context-implied` | 直前の文脈から一通りに定まる主語・目的語・条件を書き直している語句 | 文脈を与えている先行箇所の`relatedText`と`relatedLocation` |
| `audience-known` | 読者が知っていること（`contract.audience.knows`）を説明している記述 | `knownItem`に`audience.knows`の項目をそのまま写す |
| `off-contract` | どの要件にも`readerDelta`にも寄与しない記述 | なし |

`text`には削る範囲を原文のまま写し、`location`の行範囲内で一つに定まる長さにしてください。`relatedText`は`text`より前になければなりません。参照を持たない種類では`relatedText`、`relatedLocation`、`knownItem`を`null`にします。

次は余分な記述に数えないでください。

- 書き手の態度表明。本文の内容に対する感想や評価を短く添えた一言は、読者に書き手の立場を伝えます
- TL;DRやまとめのように、要約と明示された節での要点の再掲
- 誤読を防ぐために必要な主語や条件。省くと指す先が二通り以上に読める場合は残します
- 先行箇所より具体的な情報（単位、キー、数値、範囲など）を加えている語句。先行箇所から一通りに定まらないため、文脈から分かる語には当たりません
- profileが`essay`の文書で、書き手の体験や考えを語る記述

`restatement`、`context-implied`、`audience-known`は`resolution: agent`、`repairableByAgent: true`にでき、修正では該当範囲を削ります。`off-contract`は`resolution: needs_author`、`repairableByAgent: false`にしてください。本文が余分なのか契約に要件が漏れているのかは、書き手しか決められないためです。

余分な記述があれば`excessCoverage.status`を`found`、なければ`none_found`とし、理由を書きます。

## 結果の保存

結果を[`schemas/review-result.schema.json`](${CLAUDE_PLUGIN_ROOT}/schemas/review-result.schema.json)に適合するJSONとして、`<REPO_ROOT>/.jp-docs-harness/work/review-result.json`へ保存してください。`document`、`contract`、`rubricHash`、`evidenceHash`はreview packetからそのままコピーします。`judge`には現在のproviderとmodelが分かる場合は記録し、分からない場合は`current-agent`とします。`promptVersion`は`3`です。

## 表現の警戒

判定と並行して、次に該当する表現を本文から集めてください。rubricの判定には入れず、結果JSONにも含めません。

- 書き手の評価・感想が事実の形で書かれ、近くに根拠が示されていない断定（`最大の問題`、`〜しても意味がない`のような型）
- 宛先や理由が本文から読めない規範（`〜してはならない`、`〜するものではない`）
- 具体的な事実や数値を隠す比喩（`嵌まる`、`効く`、`刺さる`など）
- 執筆時の指示への応答が本文へ漏れた文。脈絡なく現れる除外宣言（`〜には触れない`、`〜は割愛する`）は、読者がその情報で判断や行動を変えられるかで見分けてください。参照先や理由を伴うスコープ宣言は読者向けとして正当です。契約に`non_goals`がある場合、その話題を本文がなぞって除外宣言している箇所は漏れの可能性が高くなります

根拠を先に示した評価と、仕様の適合要件として書かれた規範（profileが`reference`の場合など）は正当なので挙げないでください。該当箇所は最後の報告で、行番号と言い換え案を添えて助言として示してください。この観点では本文を自動修正しません。

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

本文を修正するときは、次を守ってください。

- 文脈から分かる主語・目的語・条件を補わない。不足の指摘は、欠けている情報だけを足して解消する
- 指摘された語は、言い換えるより先に、その語や文を削れないかを検討する
- 修正後の本文が修正前より長くなった場合は、増えた理由を最後の報告に書く

本文を修正した場合、review packetと結果は古くなります。修正後にprepare、判定、record、verifyを一度だけやり直してください。二回目にも問題が残る場合は自動修正を繰り返さず、未解決の指摘を利用者へ返してください。

最後に、対象文書、契約を新規作成したか、修正内容、書き手の入力が必要な項目、未解決の不確実性、保存したレビュー結果の場所を簡潔に報告してください。
