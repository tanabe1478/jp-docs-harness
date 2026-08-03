---
description: 同梱コーパスで現在のJudgeを評価し、次元別の回帰結果を生成します。
argument-hint: "<candidate出力ディレクトリ>"
disable-model-invocation: true
---

candidateの出力先は`$ARGUMENTS`です。空の場合は推測せず、出力ディレクトリを利用者へ確認してください。

## Packet生成

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" eval-prepare "$ARGUMENTS"
```

出力先の`manifest.json`を読み、列挙された全ケースを評価してください。各`packetFile`だけを判定材料にします。`eval/cases/*/gold.json`を読んだり、goldの内容を推測したりしてはいけません。

## Candidate生成

各packetについて`review-docs`と同じ判定規則を適用し、manifestの`candidateFile`へreview result Schema Version 2のJSONを書いてください。

- すべてのchecksを独立して評価する
- authorOnlyを全件評価する
- 外部検証可能な主張と書き手固有の経験を抽出する
- loadedの資料だけを根拠として引用する
- sourcePolicyがrequiredの判定をclaimIdsから指定資料へ接続する
- needs_authorをAIが解決できる問題へ変更しない
- document、contract、rubricHash、evidenceHashをpacketからそのままコピーする
- 全ケースで同じprovider、model、promptVersionをjudgeへ記録する
- promptVersionは`2`とする

評価中にコーパスの文書、契約、根拠資料を修正してはいけません。candidateの判定を良く見せるための本文修正も禁止します。

## Suite比較

全candidateを保存したら次を実行します。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-review-cli.mjs" eval-suite "$ARGUMENTS" > "$ARGUMENTS/report.json"
```

コマンドが失敗した場合は`missingCases`と`invalidCases`を確認し、candidateのSchema、ID、引用行、ハッシュの転記だけを修正してください。判定ラベルをgoldへ近づける目的で変更してはいけません。

利用者には次元ごとの結果をそのまま報告してください。複数次元を平均した総合スコアや合否は作らないでください。少なくとも次を示します。

- rubricVerdict
- rubricResolution
- accountabilityStatus
- groundingCoverage
- groundingExtraction
- groundingVerdict
- groundingResolution
- missingCases
- invalidCases
- judges
