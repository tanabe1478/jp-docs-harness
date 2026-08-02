# 意味レビューの記録と検証

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
  "schemaVersion": 1,
  "document": {
    "path": "docs/design.md",
    "contentHash": "sha256:..."
  },
  "contract": {
    "path": "docs/design.md.intent.yml",
    "contractHash": "sha256:..."
  },
  "rubricHash": "sha256:...",
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
      "justification": "インストール方法が本文の12行目から18行目にある",
      "location": {
        "startLine": 12,
        "endLine": 18
      },
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
- コンパイル済みルーブリックのハッシュが一致しない
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

## 現在の制限

現時点のFreshness gateは、結果が現在の本文と契約に対応することだけを保証します。`missing`や`contradicts`の判定を通常のfindingへ変換するSemantic result gateと、エージェントが判定結果を作る`review-docs`は次の実装対象です。
