#!/bin/bash
set -euo pipefail
git init -q .
mkdir -p docs
cat > docs/proposal.md <<'MARKDOWN'
# 検索基盤の刷新提案

現在の検索基盤は応答が遅い。刷新を提案する。

## 提案内容

新しい検索エンジンへ移行する。移行にはおよそ3か月かかる見込みである。

## 効果

検索の応答時間が改善する。運用コストも下がる。
MARKDOWN
