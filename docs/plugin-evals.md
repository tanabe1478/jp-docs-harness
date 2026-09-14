# プラグインの挙動評価

`claude plugin eval`で、このプラグインがClaude Codeの挙動を実際に変えているかを測ります。skillが自然な日本語の依頼で発火するか、発火した結果がプラグインなしの場合より良いかを、ケースごとに採点します。

## eval/ と evals/ の違い

このリポジトリには名前の似たディレクトリが二つあり、測る対象が違います。

| ディレクトリ | 測る対象 | 実行するもの |
| --- | --- | --- |
| `eval/` | 文書を判定するJudge（LLM）の回帰。判定の質が版で落ちていないか | `jp-docs-harness eval-suite` |
| `evals/` | このプラグインがClaude Codeの挙動を変えるか | `claude plugin eval` |

## 実行方法

プラグインのルートで実行します。実行のたびに実際のモデル呼び出しが発生し、課金対象です。

```console
claude plugin eval . --scaffold --trust-plugin \
  --allow-tools Bash Write Edit \
  --judge-model claude-sonnet-5 -j 3 \
  --no-publish --max-cost-usd 30
```

`--scaffold`は各ケースの`fixture.sh`を実行して検査対象のMarkdownを作ります。このスクリプトはsandboxの外で利用者の権限で動くため、自分で書いたsuiteにだけ付けてください。`--allow-tools`は、skillがCLIを起動するために必要です。

一つのケースだけを安く試す場合は、ベースラインを省いて1回だけ実行します。

```console
claude plugin eval . --case check-request-fires-check-docs --runs 1 --ablation none \
  --scaffold --trust-plugin --allow-tools Bash --no-publish
```

## ケースの構成

| ケース | 依頼の内容 | 期待する挙動 |
| --- | --- | --- |
| `check-request-fires-check-docs` | 表現の確認を求める自然な依頼 | check-docsが起動し、仕込んだ3種類の問題をすべて報告する |
| `review-request-fires-review-docs` | 目的を果たしているかのレビュー依頼 | review-docsが起動し、書き手にしか埋められない不足を差し戻す |
| `unrelated-request-fires-nothing` | Markdownを読むが検査ではない依頼 | どのskillも起動せず、質問に答える |

3件目は誤発火を防ぐための否定ケースです。skillをモデル起動可能にした版で、関係のない依頼まで拾い始めていないかを確認します。

## 測定結果

Claude Code 2.1.270、プラグイン0.20.0、各ケース3回×2アーム、judgeは`claude-sonnet-5`、エージェント側のモデルは既定。所要5分、費用は約5ドル。

| ケース | プラグインあり | なし | Δ |
| --- | --- | --- | --- |
| `check-request-fires-check-docs` | 1.00 | 0.00 | +1.00 |
| `review-request-fires-review-docs` | 1.00 | 0.67 | +0.33 |
| `unrelated-request-fires-nothing` | 1.00 | 1.00 | 0.00 |

読み取れることは三つあります。

表現の検査では差が決定的でした。プラグインなしのClaudeは、仕込んだ3種類の問題をすべて挙げることが3回とも一度もできていません。決定論的な検査は毎回すべてを拾うため、ここは網羅性の差です。

意味レビューでは、指摘の質そのものの差は小さいものでした。プラグインなしでも3回中2回は、書き手に確認すべき不足を区別できています。差が出るのは再現性と、文書契約や検証済みのレビュー結果という残る成果物のほうです。

否定ケースのΔが0であることは期待どおりです。skillをモデル起動可能にしても、無関係な依頼を横取りしていません。

## 測り方の決定

`creates-contract`と`records-review`には`arm: with-only`を付けています。文書契約と検証済みレビュー結果は、プラグインなしでは原理的に作れません。これを採点に含めるとベースラインが0へ落ちてΔが実態より大きく出るため、採点から外して指標としてだけ表示します。採点はベースラインも挑戦できる項目だけで行います。

judgeには`claude-sonnet-5`を指定しています。既定の小さいjudgeは、正しい応答を書式の違いで落とすことがありました。実際に一度、「書き手の入力が必要な項目」という節を持つ応答が3票ともFAILになっています。

`llm`のrubricは1条件に絞っています。条件を複数並べると、長い応答でjudgeが揺れます。判定を安定させたい項目は、`file_exists`や`regex`のように機械で決まるgraderへ寄せます。

## 環境についての観察

評価実行のsandboxには`git`がありませんでした。それでも単一Markdownを対象とするレビューは完走しています。`git rev-parse`でリポジトリルートを特定できない場合に、ファイルのあるディレクトリを境界とするフォールバックが働いたためです。ディレクトリ全体を対象とする検査は、この環境では実行できません。
