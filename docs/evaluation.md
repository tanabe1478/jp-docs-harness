# Judge結果の評価

`eval`コマンドは、人手で確認したgold結果とJudgeのcandidate結果を比較します。

```console
jp-docs-harness eval eval/cases/grounding-basic/gold.json candidate.json
```

品質を一つのスコアへ集約せず、次の次元を別々に出力します。

| 次元 | 内容 |
| --- | --- |
| `rubricVerdict` | 文書要件に対する判定の一致率 |
| `rubricResolution` | `agent`と`needs_author`など解決主体の一致率 |
| `accountabilityStatus` | 書き手入力の有無に関する一致率 |
| `groundingCoverage` | 主張レビューを実施したかの一致率 |
| `groundingExtraction` | 主張抽出のprecisionとrecall |
| `groundingVerdict` | 根拠充足判定の一致率 |
| `groundingResolution` | 根拠問題の解決主体に関する一致率 |

主張はIDではなく、本文の行範囲と原文で対応付けます。Judge間で連番が異なっても、同じ主張なら比較できます。

## 同梱コーパス

`eval/cases`には次のgoldケースを同梱しています。

| ケース | 検証する失敗 |
| --- | --- |
| `grounding-basic` | 根拠と一致する数値主張 |
| `grounding-conflict` | 根拠資料と矛盾する数値主張 |
| `author-experience` | AIが確認できない書き手固有の経験 |

コーパス自体の比較処理は次で確認できます。

```console
npm run eval:corpus
```

## Candidate run

同梱コーパスのreview packetとmanifestを生成します。

```console
jp-docs-harness eval-prepare .jp-docs-harness/eval-runs/claude-sonnet-p2
```

出力ディレクトリには、ケースごとの`<case>.packet.json`と`manifest.json`が入ります。Judgeはpacketだけを読み、結果をmanifestで指定された`<case>.json`へ保存します。goldはJudgeへ渡しません。

candidate一式を集計します。

```console
jp-docs-harness eval-suite .jp-docs-harness/eval-runs/claude-sonnet-p2 \
  > .jp-docs-harness/eval-runs/claude-sonnet-p2/report.json
```

run reportには次が含まれます。

- 期待するケース数と評価済みケース数
- `missingCases`
- Schema、ID、引用行などに問題がある`invalidCases`
- candidateに記録されたJudgeの一覧と`mixedJudges`
- 全ケースを合算した次元別指標
- ケースごとの次元別指標

`eval-suite`はcandidateが欠落、無効、または複数のJudgeが混在する場合に終了コード1を返します。指標が低いだけでは終了コードを1にしません。モデル品質のしきい値は、用途ごとに各次元へ個別設定してください。

Claude Code Pluginから実行する場合は次を使用します。

```text
/jp-docs-harness:eval-harness .jp-docs-harness/eval-runs/claude-sonnet-p2
```

pi packageでは次を使用します。

```text
/eval-harness .jp-docs-harness/eval-runs/claude-sonnet-p2
```

どちらのアダプターも、同梱goldを読まず現在のモデルでcandidateを生成するよう指示します。

## Run間の回帰比較

モデルまたはpromptが異なる二つのrun reportを比較します。

```console
jp-docs-harness eval-diff \
  .jp-docs-harness/eval-runs/baseline/report.json \
  .jp-docs-harness/eval-runs/candidate/report.json
```

各次元に`baseline`、`candidate`、`delta`を出力します。Grounding extractionはprecisionとrecallを分けます。比較結果にも総合スコアはありません。ケース数が異なる場合は`sameExpectedCases: false`になるため、その差を解消してから指標を比較してください。

## コーパスの作り方

各ケースへ次を保存します。

- 評価対象Markdown
- 文書契約
- ローカル根拠資料
- 人が確認したreview result

まず`prepare`でpacketを生成し、人が全チェックと全主張を判定してgold結果を作ります。candidateは同じpacketを別のモデルまたはプロンプトへ渡して生成します。

ハッシュが異なる結果同士を比較しないでください。`eval`はラベルの比較に専念し、入力の鮮度検査は`record`と`verify`が担当します。

## 結果の読み方

`accuracy`はgoldに存在する項目数を分母にします。項目がない次元は`null`です。`missing`と`unexpected`を併記するため、高い一致率だけで抽出漏れを隠せません。

モデル採用時は、少なくともGrounding、Accountability、要件判定を個別に確認してください。平均値や重み付き総合スコアを製品の合否判定へ使わないでください。
