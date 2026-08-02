# 意味レビューの記録と検証

review packetとreview resultの現在の`schemaVersion`は`2`です。Version 1の保存結果はGrounding情報を持たないため、prepareとレビューをやり直してください。

## 処理の流れ

意味レビューは、生成、判定、記録、鮮度確認を分けて実行します。

1. `prepare`でreview packetを生成する
2. Claude Codeまたはpiが各チェックを判定する
3. 判定結果をJSONとして保存する
4. `record`でJSONを検証し、所定の場所へ記録する
5. `verify`で本文と契約のハッシュを照合する

## Review packetを作る

```console
jp-docs-harness prepare docs/design.md > review-packet.json
```

review packetの`rubric.checks`に、独立して判定するチェックが入ります。Judgeはすべてのチェックを一件ずつ評価します。

## 判定結果を作る

判定結果は次の構造です。

```json
{
  "schemaVersion": 2,
  "document": {
    "path": "docs/design.md",
    "contentHash": "sha256:..."
  },
  "contract": {
    "path": "docs/design.md.intent.yml",
    "contractHash": "sha256:..."
  },
  "rubricHash": "sha256:...",
  "evidenceHash": "sha256:...",
  "judge": {
    "provider": "anthropic",
    "model": "claude-sonnet",
    "promptVersion": "1"
  },
  "evaluations": [
    {
      "checkId": "critical-001-fact",
      "verdict": "meets",
      "resolution": "none",
      "justification": "p95の応答時間が本文の20行目にあり、測定結果と一致する",
      "location": {
        "startLine": 20,
        "endLine": 20
      },
      "claimIds": ["claim-001"],
      "repairableByAgent": false
    }
  ],
  "authorEvaluations": [
    {
      "item": "このプロジェクトを作った理由",
      "status": "missing",
      "justification": "本文と指定資料に書き手の動機がない",
      "location": null
    }
  ],
  "groundingCoverage": {
    "status": "reviewed",
    "justification": "性能に関する検証可能な主張を確認した"
  },
  "claimEvaluations": [
    {
      "claimId": "claim-001",
      "text": "p95の応答時間は100msです。",
      "kind": "factual",
      "verdict": "supported",
      "resolution": "none",
      "justification": "測定結果と一致する",
      "location": { "startLine": 20, "endLine": 20 },
      "evidence": [
        { "sourceId": "benchmark", "startLine": 4, "endLine": 4 }
      ],
      "repairableByAgent": false
    }
  ]
}
```

各チェックの判定には、`meets`、`partially_meets`、`missing`、`contradicts`のいずれかを使用します。

`resolution`は解決を担当する主体を表します。

| 値 | 意味 |
| --- | --- |
| `agent` | AIが根拠を保ったまま修正できる |
| `needs_author` | 書き手の入力がなければ解決できない |
| `uncertain` | 利用可能な資料では判定できない |
| `none` | 修正が不要 |

## 結果を記録する

```console
jp-docs-harness record review-packet.json review-result.json
```

既定の保存先は次の通りです。

```text
.jp-docs-harness/reviews/<Markdownのパス>.review.json
```

`record`は次の問題がある結果を拒否します。

- review packetと本文パスまたはハッシュが一致しない
- 文書契約のパスまたはハッシュが一致しない
- コンパイル済みルーブリックまたは根拠資料のハッシュが一致しない
- 必要なcheck IDが不足している
- 未知または重複したcheck IDがある
- `author_only`の評価が不足している
- 根拠行が本文の行数を超えている
- JSON Schemaに適合していない

保存先を変える場合は`--output`を使用します。

```console
jp-docs-harness record packet.json result.json --output artifacts/review.json
```

独自の保存先に記録した結果は、既定のFreshness gateからは参照されません。

## 鮮度を確認する

```console
jp-docs-harness verify docs/design.md
```

結果は四状態です。

| 状態 | 意味 |
| --- | --- |
| `fresh` | 本文、契約、チェック一覧が保存結果と一致する |
| `missing` | 保存結果がない |
| `stale` | 本文または契約が変更されている |
| `invalid` | Schema違反やチェックの過不足がある |

`contracted`と`strict`モードでは、有効な文書契約がある文書に`fresh`な結果を要求します。

```console
jp-docs-harness lint --review-mode contracted docs/design.md
```

`manual`モードでは保存結果がなくても失敗しません。保存結果が存在するものの古い場合は警告します。

## Grounding

review packetの`grounding.sources`には、契約で宣言したローカル資料の内容、ハッシュ、状態が入ります。Judgeは本文から外部検証可能な事実、推奨、書き手固有の経験を抽出し、`claimEvaluations`へ記録します。

| 判定 | 意味 |
| --- | --- |
| `supported` | ローカルスナップショットに主張を支える記述がある |
| `partially_supported` | 主張の一部だけを根拠で確認できる |
| `unsupported` | 利用可能な根拠では確認できない |
| `conflicts` | 根拠資料と矛盾する |
| `not_applicable` | 外部根拠を必要としない |

`record`は主張の原文が指定された本文行に存在すること、引用先IDが宣言済みであること、根拠行が資料の範囲内であることを検証します。`external`、`missing`、`missing-snapshot`、`invalid-snapshot`の資料は引用できません。Evidence gateは、必須資料がこれらの状態なら意味レビュー前にfindingを生成します。

## エージェントから実行する

Claude Code Pluginでは、名前空間付きSkillを使用します。

```text
/jp-docs-harness:review-docs docs/design.md
```

pi packageでは、次のコマンドを使用します。

```text
/review-docs docs/design.md
```

どちらもprepare、全チェックの判定、record、verifyを順番に実行します。AIが修正できる指摘は一度だけ修正し、`needs_author`は本文を変更せず利用者へ返します。

## Semantic result gate

保存結果が`fresh`な場合、Semantic result gateが判定を通常のfindingへ変換します。

- Answer-Criticalの`missing`と`partially_meets`はerror
- `contradicts`は重要度にかかわらずerror
- Valuableの問題はwarning
- Contextの問題はinfo
- author-onlyの`missing`は`needs_author`のerror
- 根拠と矛盾する主張はerror
- 根拠のない書き手固有の経験は`needs_author`のerror

これにより、Surface、Contract、Freshness、Semanticの結果を同じJSONレポートで扱えます。
