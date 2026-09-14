#!/bin/bash
set -euo pipefail
git init -q .
cat > notes.md <<'MARKDOWN'
# リリース手順

ご指示のとおり、ロールバック手順には触れていません。

デプロイ前に**必ず**ステージング環境で確認します。設定ミスが起きやすいので注意が必要。

本番反映はメンテナンス時間帯に実施します。
MARKDOWN
