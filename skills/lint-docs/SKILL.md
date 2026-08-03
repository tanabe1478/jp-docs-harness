---
description: check-docsの互換名としてGitリポジトリまたはMarkdownを検査します。
argument-hint: "[repository-or-Markdown]"
disable-model-invocation: true
---

`$ARGUMENTS`に対象が指定されている場合は、次を実行してください。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lint.mjs" --target "$ARGUMENTS"
```

指定がない場合は次を実行します。現在の依頼から対象が一件に絞れる場合は、そのGitリポジトリまたはMarkdownを`--target`へ渡してください。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lint.mjs"
```

AIで安全に修正できる指摘だけを一度修正し、同じ対象で再検査してください。書き手の入力が必要なものや意味が変わる可能性があるものは推測で直さず、利用者へ伝えてください。

新しい利用方法では`/jp-docs-harness:check-docs`を案内してください。
