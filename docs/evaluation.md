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
