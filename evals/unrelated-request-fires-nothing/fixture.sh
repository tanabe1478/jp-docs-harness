#!/bin/bash
set -euo pipefail
cat > README.md <<'MARKDOWN'
# sample-app

## セットアップ

依存パッケージをインストールします。

```console
pnpm install
```

その後、開発サーバーを起動します。

```console
pnpm dev
```
MARKDOWN
