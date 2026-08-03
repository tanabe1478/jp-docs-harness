---
description: 指定したGitリポジトリまたはMarkdownをtextlintで検査し、指摘を修正します。
argument-hint: "[repository-or-Markdown]"
disable-model-invocation: true
---

対象は`$ARGUMENTS`です。指定がある場合は次を実行してください。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lint.mjs" --target "$ARGUMENTS"
```

指定がない場合は次を実行します。Claude Codeを複数リポジトリの親ディレクトリから起動していると、コマンドは安全のため対象指定を求めて終了します。

```console
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lint.mjs"
```

指摘がある場合は、対象のMarkdownを読み、意味を変えないように文章を修正してください。すべての修正後に同じコマンドを再実行し、指摘がなくなったことを確認してください。

ルールを無効化したり、許可リストへ追加したりして指摘を回避しないでください。修正によって意味が変わる可能性がある場合は、文書を変更せずに指摘内容を利用者へ伝えてください。
