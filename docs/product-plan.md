# jp-docs-harness 製品構想と開発計画

## この文書の位置付け

この文書は、jp-docs-harnessを日本語向けの表現lintから、AIと人間が共同で書いた文書の目的適合性を検証するハーネスへ発展させるための計画です。

構想の出発点は、laiso氏による次の記事です。

- [AIの作文はなぜつまらないのか？](https://sizu.me/laiso/posts/c1h12v4v0zr5)
- [なぜAI臭さを消したいのか？](https://sizu.me/laiso/posts/mcerekex7091)

完全性の検査設計では、[GAMUT論文](https://arxiv.org/pdf/2607.19322)の二段階メタルーブリックを参考にします。採用する部分と本プロジェクト独自の拡張は、[GAMUT論文から取り入れる設計](./research/gamut.md)に整理しています。

本計画は記事や論文の内容をそのまま規則へ変換するものではありません。それぞれが提起した問題と手法を、本プロジェクトで検査可能なソフトウェア要件へ落とし込んだものです。

## 問題設定

AIが生成した文章への不満は、AI特有の語彙や記号だけでは説明できません。二つの記事から、少なくとも次の問題を読み取れます。

1. 分量に対して得られる情報が少なく、読者が費やした時間や注意に見合わないことがある
2. 創造的な文章の面白さには、反復可能で安定した評価方法がまだ乏しい
3. AIらしい表現を消すことと、内容を確認して責任を持つことは異なる
4. 表面的な指紋だけを消すと、確認していない文章を確認済みに見せる危険がある
5. 文書の種類によって、有用な説明、具体例、ナビゲーションの基準が変わる

完成した文章だけを見て「意味があるか」と問う方法には限界があります。文章の目的、想定読者、必要な根拠、書き手自身にしか提供できない情報がなければ、判定基準を作れないためです。

## 製品の目標

jp-docs-harnessを、次の役割を持つツールへ育てます。

> 文書契約に基づいて、生成された文章の目的適合性、根拠、情報密度、書き手の責任を検証するハーネス

ここでいう文書契約とは、文書を書く前に定義する目的、読者、必須内容、根拠、非目標の組み合わせです。ハーネスは文章の見た目だけでなく、契約に対して必要な内容が揃っているかを検査します。

目標はAIらしさの除去ではありません。読者が文書を読む前後で、理解、判断、行動のいずれかを更新でき、その更新を根拠で支えられる状態を目指します。

## 設計原則

### 意味を文体より優先する

意味や根拠の欠落はエラー候補とし、AIに多い表現は原則として警告に留めます。表現が粗くても検証可能な情報を含む文書は、自然な文体で中身がない文書より価値があります。

### 総合点へ集約しない

品質を一つの点数へ潰さず、狭く判定可能な検査結果を並べます。総合点は、具体例や文章量を増やして点数を稼ぐような最適化を招く可能性があります。

GAMUTはベンチマーク比較のために重要度別の判定を重み付きスコアへ集約します。本プロジェクトでは、同様の数値をevalにおける比較指標として検討できますが、製品の合否判定には使用しません。

### AIが書き手の経験を補完しない

書き手の経験、動機、判断理由が不足している場合は`needs_author`として返します。もっともらしい経験をAIに創作させて合格させてはいけません。

### 判定根拠を要求する

意味に関する指摘には、対象行、段落、参照資料のいずれかを要求します。根拠箇所を示せない指摘は自動修正へ進めません。

### 不確実性を残す

判定できない内容を無理に合格または不合格へ分類せず、`uncertain`として利用者へ返します。

### エージェント統合を薄く保つ

検査、結果形式、キャッシュはモデルやエージェントに依存しないコアへ置きます。piとClaude Codeは、実行タイミングとモデルへのフィードバックだけを担当します。

## 非目標

このプロジェクトでは、次の機能を目標にしません。

- AIが書いた文章か人間が書いた文章かを判定する
- 人間らしさや面白さを単一の点数で表す
- すべての文書を同じ文体へ統一する
- 書き手固有の経験や意見をAIに創作させる
- 根拠のない指摘を使って文章を自動修正する
- LLMによる意味判定を毎回リポジトリ全体へ実行する

## 文書契約

対象のMarkdownと同じ場所に、`<文書名>.intent.yml`を置きます。たとえば`article.md`の契約は`article.md.intent.yml`です。

```yaml
version: 1
profile: technical-explainer

audience:
  knows:
    - Claude Codeの基本的な使い方
    - Stop hookという用語
  problem:
    - AIが書いたMarkdownの品質を終了時に検査したい

reader_delta:
  know:
    - jp-docs-harnessが検査する内容
    - piとClaude Codeにおける実行タイミング
  decide:
    - 自分のプロジェクトへ導入すべきか
  do:
    - インストールして手動検査を実行する

requirements:
  critical:
    - textlintだけでは意味や根拠を検査できないこと
    - piとClaude Codeにおける検査の流れ
    - 自動修正の反復を制限する理由
  valuable:
    - 導入先のpackage.jsonを変更しないこと
    - 検査コストと実行頻度のトレードオフ
  context:
    - 開発環境でmiseを使っていること

evidence:
  sources:
    - id: repository
      path: .
  author_only:
    - このプロジェクトを作ろうと思った理由
    - AI文章の利用で実際に困った経験
    - 自動修正の反復を制限した設計上の判断

non_goals:
  - AIが生成した文章かどうかを判定する
  - あらゆる文章を同じ文体へ統一する
```

### 必須度

`requirements`は三段階に分けます。

| 区分 | 意味 | 既定の扱い |
| --- | --- | --- |
| `critical` | 欠けると文書の目的を達成できない | error |
| `valuable` | 読者の理解や判断を大きく改善する | warning |
| `context` | 理解を助ける背景情報 | info |

### 書き手への差し戻し

`author_only`に指定された情報が本文と根拠資料のどちらにもない場合、ハーネスは不足を明示します。

```text
NEEDS_AUTHOR accountability-002

「自動修正の反復を制限した理由」が本文にありません。
利用可能な資料だけでは判断できません。

必要な入力候補:
- 無限修正ループを避けるためか
- APIコストや待ち時間を抑えるためか
- 人間へ早めに判断を戻すためか
```

この結果をAIが推測で解消することは禁止します。

## 二段階メタルーブリック

Completenessの設計にはGAMUTの二段階表現を応用します。

第1段階では、完全な文書に必要な内容を構造化メタルーブリックで表します。型には`Simple Knowledge`、`Strict List`、`Flexible List`、`Process`、`Relationship`を使用します。個別項目では表せない共通傾向が検査対象になる場合は、複数項目を横断する`meta-insight`を持たせます。重要度は`Answer-Critical`、`Valuable`、`Context`の三段階です。

第2段階では、固定規則を使ってメタルーブリックを自己完結した狭いチェックへ変換します。Strict Listは項目ごとのチェック、Flexible Listは最低網羅率のチェック、Processは各手順の存在と順序のチェックへ変換します。重要度の継承とチェックの展開はLLMではなくコードが担当します。

初期のintent形式では`critical`、`valuable`、`context`の文字列一覧を簡略記法として許可し、それぞれ`Simple Knowledge`へ変換します。型付き要件はPhase 2で追加します。

## 検査モデル

文書契約のメタルーブリックから、独立して判定できるチェックを生成します。

```yaml
checks:
  - id: critical-001
    type: knowledge
    question: >
      本文は、textlintでは文章の意味や根拠まで
      検査できないことを説明しているか？

  - id: critical-002
    type: process
    question: >
      piでMarkdown編集を検知してから検査と修正に至る
      実行順序が説明されているか？

  - id: critical-003
    type: rationale
    question: >
      自動修正の反復を制限する理由が説明されているか？
    source_policy: author-required
```

内容に対するJudgeの判定には、GAMUTに合わせて`meets`、`partially_meets`、`missing`、`contradicts`を使用します。欠落と、読者を誤らせる矛盾を区別するためです。

`needs_author`と`uncertain`は内容判定とは別の解決状態として扱います。たとえば`verdict: missing`かつ`resolution: needs_author`のように、何が不足しているかと誰が解決すべきかを分離します。総合スコアは算出しません。

## 検査ゲート

### Surface

既存のtextlintと`@textlint-ja/textlint-rule-preset-ai-writing`を使用します。重複表現、過剰な強調、機械的な箇条書きなど、表層と構造の問題を安価に検出します。

Surfaceは最初に実行する安価なゲートです。将来の意味検査を追加しても削除しません。

### Contract

対象文書に必要な契約が存在し、スキーマに適合しているかを検査します。契約を必須にする範囲は実行モードで制御します。

### Completeness

`critical`、`valuable`、`context`を個別の問いへ変換し、本文が必要事項を含むかを確認します。自動ブロックの対象は原則として`critical`だけです。

### Grounding

本文を原子的な主張へ分割し、根拠との関係を記録します。

| 主張の種類 | 検査方針 |
| --- | --- |
| `verifiable-fact` | コード、一次資料、指定資料で検証する |
| `inference` | 前提となる事実と推論のつながりを確認する |
| `opinion` | 事実のように偽装されていないか確認する |
| `experience` | 書き手から提供された情報か確認する |
| `proposal` | 現状の事実ではなく提案として記述されているか確認する |

意見や提案を根拠不足として一律に落としません。事実、推論、評価の境界が読者に分かることを重視します。

### Contribution

各段落が文書の目的へどのように寄与するかを分類します。

| 役割 | 読者に与える変化 |
| --- | --- |
| `world-update` | 新しい事実や具体例を与える |
| `model-update` | 理解の枠組みや因果関係を更新する |
| `decision-update` | 判断材料やトレードオフを与える |
| `action-update` | 次の行動を可能にする |
| `cognitive-support` | 例、要約、接続、ナビゲーションで理解を助ける |
| `document-only` | 文書の進行だけを説明する |

段落を削除しても必須チェック、理解、後続段落の解釈が変わらず、認知的な補助にもなっていない場合は低寄与として警告します。

### Genericity

対象固有の情報を別分野の語へ置き換えても成立する一般論を検出します。検出した場合は、実例、条件、数値、失敗例、比較対象、判断理由、反例の追加を求めます。

書き手の実体験が必要な場合は、AIによる補完ではなく`needs_author`を返します。

### Reader QA

`reader_delta`から、読後に答えられるべき質問を作ります。本文だけを使って回答し、次の状態を記録します。

- 回答できる
- 一部だけ回答できる
- 回答できない
- 本文内で矛盾する

単なる文字列の存在ではなく、読者が必要な知識を取り出せる形になっているかを確認するためのゲートです。

### Accountability

書き手固有の経験、動機、判断をAIが捏造していないかを検査します。自動修正より人間への差し戻しを優先するゲートです。

## 文書プロファイル

文書の種類に応じて評価基準を切り替えます。

| プロファイル | 重視する項目 | 固有の方針 |
| --- | --- | --- |
| `technical-explainer` | 正確性、完全性、判断材料 | ナビゲーション段落を許容する |
| `tutorial` | 実行可能性、前提、失敗時の回復 | 具体例と確認手順を求める |
| `decision-proposal` | 選択肢、トレードオフ、推奨理由 | 反対案または不採用理由を求める |
| `essay` | 主題、書き手の立場、具体的経験 | 未解決の緊張を許容する |
| `reference` | 検索性、網羅性、一貫性 | 段落寄与の検査を弱める |

プロファイルを導入する理由は、特定のエッセイ文体を全ドキュメントへ強制しないためです。APIリファレンスに驚きや個人的経験を求める必要はありません。

## 結果形式

LLMへ自由記述のレビューを依頼せず、機械可読な結果を要求します。

```json
{
  "document": "docs/design.md",
  "profile": "technical-explainer",
  "contentHash": "sha256:...",
  "contractHash": "sha256:...",
  "verdict": "needs_author",
  "findings": [
    {
      "id": "grounding-003",
      "gate": "grounding",
      "severity": "error",
      "status": "unsupported",
      "location": {
        "startLine": 42,
        "endLine": 44
      },
      "claim": "Stop hookは必ず一度だけ実行される",
      "reason": "提示された設定だけでは実行回数を保証できない",
      "suggestedActions": [
        "断定を弱める",
        "Claude Codeの仕様資料を追加する"
      ],
      "repairableByAgent": true
    },
    {
      "id": "accountability-001",
      "gate": "accountability",
      "severity": "error",
      "status": "needs_author",
      "location": null,
      "reason": "設計理由が資料にない",
      "repairableByAgent": false
    }
  ]
}
```

結果形式には次の制約を設けます。

1. 指摘には対象行、段落ID、参照資料のいずれかを含める
2. AIが修正できる問題と人間の入力が必要な問題を分ける
3. `needs_author`をAIの創作で解決しない
4. `uncertain`を無理に不合格へ変換しない
5. 本文と契約のハッシュを保存し、古い結果を再利用しない

## 実行モード

意味検査の頻度はプロジェクトごとに選択できるようにします。

```yaml
review:
  semantic:
    mode: manual
```

| モード | 動作 |
| --- | --- |
| `manual` | `/review-docs`を実行したときだけ意味検査する |
| `contracted` | intentファイルがある変更済みMarkdownを検査する |
| `strict` | 対象Markdownの変更時に有効な意味検査結果を必須にする |

既定値は`manual`を想定します。LLMを使う検査を暗黙に増やさず、コストと待ち時間を利用者が選べるようにするためです。

## コアコマンド

エージェントに依存しないCLIを用意します。

| コマンド | 役割 |
| --- | --- |
| `prepare` | 文書、契約、参照資料からreview packetを作る |
| `lint` | textlintなど決定論的な検査を実行する |
| `record` | LLM JudgeのJSON結果を検証して保存する |
| `verify` | 本文と契約に対して保存結果が新しいか確認する |
| `report` | 人間向けのMarkdownレポートを生成する |

`prepare`と`record`の間にある意味判定は、現在のエージェントまたは外部コマンドが担当します。コアから特定のLLM APIを直接呼ぶことは初期段階の要件に含めません。

## Claude Codeでの動作

Claude CodeのStop hookから別のClaudeプロセスを起動しません。再帰、追加コスト、認証管理を避けるためです。

想定する処理は次の順序です。

1. Markdownを編集する
2. Stop hookでSurfaceと結果の鮮度を検査する
3. 必要な意味検査結果がない場合は終了を差し戻す
4. 現在のClaudeが`/jp-docs-harness:review-docs`を実行する
5. Skillがreview packetを読み、チェックごとのJSONを作る
6. `record`で結果を保存する
7. AIが修正可能な指摘だけを修正する
8. `needs_author`を利用者へ伝える
9. Stop hookが`verify`を実行する

`manual`モードでは、現在の`lint-docs`と同様に利用者が明示的に実行します。`contracted`と`strict`だけがStop hookで意味検査の鮮度を要求します。

## piでの動作

piでは、既存の`agent_settled`連携を拡張します。

1. `write`または`edit`で変更されたMarkdownを記録する
2. `agent_settled`で変更された文書だけを対象にする
3. Surfaceを実行する
4. 必要ならreview packetを作る
5. 意味検査をfollow-upとして現在のエージェントへ依頼する
6. AIが修正可能な指摘だけを一度修正する
7. 未解決の指摘と`needs_author`を利用者へ返す

意味検査は、本文ハッシュまたは契約ハッシュが変わった場合だけ実行します。同じプロンプト、モデル、ルーブリックによる有効な結果があれば再利用します。

## LLM Judgeの制約

文章を生成したモデルと評価するモデルが同じ場合、独立した検証にはなりません。piやClaude Code内で完結する利便性を保ちながら、自己評価の偏りを減らします。

- 生成時の会話や自己説明をJudgeへ渡さない
- 完成稿、文書契約、許可された参照資料だけを渡す
- 総合評価ではなく独立した狭いチェックに分ける
- 本文中の根拠行を要求する
- 修正前後を比較する場合は提示順を入れ替える
- モデル名、プロンプト版、ルーブリック版を結果へ保存する

将来は、別モデルを呼び出すコマンドを任意に指定できるようにします。

```yaml
judge:
  provider: current-agent
  command: null
```

`provider: command`の場合は、標準入力でreview packetを渡し、標準出力から所定のJSONを受け取る設計を候補とします。

## 評価用コーパス

意味ゲートを実装する前に、`eval/`へ回帰検査用の対比例を用意します。

```text
eval/
  cases/
    unsupported-claim/
      intent.yml
      good.md
      bad.md
      expected.json
    generic-filler/
    duplicated-conclusion/
    missing-critical-item/
    fabricated-experience/
    useful-navigation/
    style-clean-but-empty/
    style-rough-but-valuable/
```

最低限、次の対を含めます。

- AIらしい表現を含むが意味のある文章と、自然な文体だが中身のない文章
- ナビゲーションが必要なチュートリアルと、同じ説明が冗長になるエッセイ
- 一般論を削ると意味が壊れる文章と、削っても何も失われない文章
- 根拠のある提案と、事実のように書かれた根拠のない推測
- 書き手が提供した経験と、AIが創作した経験

人間による正解ラベルも総合点ではなく、critical情報の有無、主張の根拠、削除可能な段落、必要な書き手入力などの個別項目にします。

## 目標ディレクトリ構成

```text
jp-docs-harness/
  bin/
    jp-docs-harness.mjs
  lib/
    core/
      target-files.mjs
      content-hash.mjs
      result-schema.mjs
      report.mjs
    gates/
      surface.mjs
      contract.mjs
      completeness.mjs
      report-freshness.mjs
    semantic/
      prepare-review.mjs
      compile-rubric.mjs
      claim-schema.mjs
      record-review.mjs
    adapters/
      textlint.mjs
  profiles/
    technical-explainer.yml
    tutorial.yml
    decision-proposal.yml
    essay.yml
    reference.yml
  schemas/
    intent.schema.json
    review-result.schema.json
  skills/
    lint-docs/
    review-docs/
  extensions/
    docs-harness-on-settle.ts
  hooks/
  eval/
  tests/
```

既存のClaude Code Pluginとpi packageの配布構造は維持します。

## ロードマップ

### Phase 0: 現在の基盤

現在はSurface gateだけを実装しています。

- AI writing presetによるMarkdown検査
- 共通のtextlint実行処理
- Claude Code PluginのStop hook
- pi packageの`agent_settled`連携
- Claude Codeとpiの手動lintコマンド
- 自動修正の反復を一度に制限する状態管理

### Phase 1: 検査基盤の一般化

Phase 1は完了しました。`runHarness`、対象ファイル指定、共通finding形式、本文ハッシュ、JSON出力、Node.js標準テストランナー、Surface gate、Contract gate、Freshness gateを導入しました。

textlint専用の実行処理を、複数ゲートを扱える`runHarness`へ置き換えます。

実装対象は次の通りです。

- 変更されたファイルだけを受け取るtarget file API
- findingの共通JSON Schema
- JSON出力と人間向け出力の分離
- 本文のSHA-256ハッシュ
- Surface、Contract、Freshnessのゲートインターフェース
- Node.js標準テストランナーによる単体テスト

完了条件を次に定めます。

- CLI、Claude Code、piが同じfinding形式を利用する
- 単一ファイルと複数ファイルを選択して検査できる
- 同じ入力から決定論的に同じJSONを生成する
- 既存のtextlint検出を回帰テストで維持する

### Phase 2: Document ContractとCompleteness

Phase 2の基盤は完了しました。`*.intent.yml`のJSON Schema、YAML検証、契約ハッシュ、`manual`、`contracted`、`strict`の実行モード、型付きメタルーブリックのコンパイラ、review packet、結果の記録と鮮度確認を導入しました。現在のエージェントによるチェック判定はPhase 3の`review-docs`で接続します。この段階では意味に関する自動修正を行いません。

実装対象は次の通りです。

- intent JSON Schema
- YAMLの読み込みと検証
- 型付きメタルーブリックからの決定論的なチェック生成
- 簡略記法の`critical`、`valuable`、`context`から`Simple Knowledge`への変換
- review packetの生成
- `manual`と`contracted`の実行モード
- `contentHash`と`contractHash`

完了条件を次に定めます。

- 不正な契約を行番号付きで報告できる
- review packetが本文、契約、参照資料の境界を保持する
- Answer-Critical項目の検査結果を独立して保存できる
- Strict List、Flexible List、Processのコンパイル規則を単体テストで確認できる
- 契約または本文の変更後に古い結果を検出できる

### Phase 3: GroundingとAccountability

Phase 3のMVPは完了しました。`record`、`verify`、レビュー結果のJSON Schema、Freshness gate、Semantic result gate、Claude Codeとpiの`review-docs`、ローカルおよびURL根拠資料のスナップショット、主張単位のGroundingを導入しました。Judge結果を次元別に比較する`eval`、GroundingとAccountabilityの評価コーパス、candidate runの生成と集計、Claude Codeとpiの`eval-harness`も利用できます。次は実運用データによるhardeningとCI連携です。

主張と根拠を扱い、AIが修正できる問題と書き手へ返す問題を分けます。

実装対象は次の通りです。

- 主張種別のSchema
- 根拠参照の形式
- `needs_author`と`repairableByAgent`
- 結果を検証して保存する`record`
- 保存結果を確認する`verify`
- Claude Codeとpiの`review-docs`

完了条件を次に定めます。

- 根拠のない事実主張を検出するeval caseが通る
- 意見と提案を事実主張と区別できる
- author-onlyの不足をAIが自動修正しない
- 無効な行番号や存在しない根拠を`record`が拒否する

### Phase 4: Contribution、Genericity、Reader QA

Judge依存が強いゲートを、評価用コーパスで誤検出を測りながら追加します。

実装対象は次の通りです。

- 段落IDと段落役割
- 段落アブレーション用チェック
- ドメイン置換による一般論の検査
- reader deltaからの質問生成
- 修正前後の比較評価

完了条件は、ゲートごとにeval caseと許容する誤検出率を定めた後に確定します。評価基準がない状態で自動ブロックへ追加しません。

### Phase 5: 外部Judgeと運用機能

必要性が確認できた機能だけを追加します。

候補は次の通りです。

- `provider: command`による外部Judge
- モデル、プロンプト、ルーブリック単位のキャッシュ
- CI向けの非対話モード
- SARIFまたはGitHub Checksへの出力
- 文書プロファイルの追加方法
- プロジェクト固有ゲートのPlugin API

## 初期マイルストーン

最初に実装する核を次の四点に絞ります。

1. `*.intent.yml`
2. 構造化されたfinding JSON
3. `needs_author`
4. 本文と契約のハッシュによる結果の鮮度管理

この四点が揃うまでは、万能なLLM Judgeや自動修正ゲートを増やしません。目的と責任の境界を先に機械可読にすることが、表面的なAIらしさの除去から離れるための最短経路です。

## 未決事項

実装前に、次の点を小さな試作とeval caseで決めます。

- intentファイルの命名を`article.md.intent.yml`へ固定するか
- Markdown以外の文書形式を初期対象に含めるか
- `critical`の不合格を既定でブロックするか
- 参照可能なURLを誰が取得し、いつスナップショット化するか
- 行番号が編集で変わった場合に段落IDをどう維持するか
- 同じモデルによる生成と評価をどこまで許容するか
- 日本語のJudge評価に対する許容誤差をどう測るか
- 文書や参照資料に含まれる機密情報を外部Judgeへ渡さない仕組み

## 判断基準

新しいルールやゲートを追加するときは、次の問いに答えられることを必須とします。

1. この検査は読者の理解、判断、行動のどれを改善するか
2. 表面的なAIらしさではなく、文書の目的に結び付いているか
3. 誤検出を示す対比例がevalにあるか
4. 指摘の根拠箇所を示せるか
5. AIが修正してよいか、人間へ返すべきかを区別できるか
6. piとClaude Code以外からも同じコアを実行できるか

これらに答えられない機能は、既定の検査ゲートへ追加しません。
