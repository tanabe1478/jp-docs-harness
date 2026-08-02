---
description: 日本語のMarkdown文書をtextlintで検査し、指摘を修正します。
disable-model-invocation: true
---

`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude-lint.mjs"`を実行してください。

指摘がある場合は、対象のMarkdownを読み、意味を変えないように文章を修正してください。すべての修正後に同じコマンドを再実行し、指摘がなくなったことを確認してください。

ルールを無効化したり、許可リストへ追加したりして指摘を回避しないでください。修正によって意味が変わる可能性がある場合は、文書を変更せずに指摘内容を利用者へ伝えてください。
