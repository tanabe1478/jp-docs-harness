---
description: check-docsの互換名として日本語Markdownを検査します。
argument-hint: "[Markdownファイル]"
disable-model-invocation: true
---

`$ARGUMENTS`にMarkdownファイルが指定されていれば、そのファイルを末尾へ追加して次のコマンドを実行してください。指定がなければ、現在の依頼で編集したMarkdownを特定できる場合はそのファイルを、特定できない場合はプロジェクト全体を検査します。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lint.mjs"
```

AIで安全に修正できる指摘だけを一度修正し、同じ対象で再検査してください。書き手の入力が必要なものや意味が変わる可能性があるものは推測で直さず、利用者へ伝えてください。

新しい利用方法では`/jp-docs-harness:check-docs`を案内してください。
