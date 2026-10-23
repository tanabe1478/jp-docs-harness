#!/usr/bin/env bash
# Linux 版のデスクトップアプリを Docker の中でビルドし、deb をインストールして、
# 仮想ディスプレイ（Xvfb）の上で tests/desktop/run.mjs の通しのテストを実行する。
# 使い方: bash tests/desktop/linux-docker.sh（Docker が必要。ホストと同じ CPU アーキテクチャでビルドする）
set -euo pipefail
repository="$(cd "$(dirname "$0")/../../.." && pwd)"
node_version="22.23.1"

docker run --rm --init -v "$repository":/src:ro -e NODE_VERSION="$node_version" rust:1-bookworm bash -euo pipefail -c '
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq libwebkit2gtk-4.1-dev build-essential curl file libxdo-dev libssl-dev \
    libayatana-appindicator3-dev librsvg2-dev xvfb xauth dbus dbus-x11 rsync xz-utils >/dev/null
  case "$(dpkg --print-architecture)" in arm64) arch=arm64 ;; amd64) arch=x64 ;; *) echo "未対応のアーキテクチャ"; exit 1 ;; esac
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz" | tar -xJ -C /opt
  export PATH="/opt/node-v${NODE_VERSION}-linux-${arch}/bin:$PATH"

  rsync -a --exclude node_modules --exclude target --exclude runtime --exclude binaries \
    --exclude test-results --exclude dist --exclude .git /src/ /work/
  cd /work/studio
  npm ci --registry https://registry.npmjs.org --no-audit --no-fund --loglevel=error
  npx tauri build --debug --bundles deb
  dpkg -i src-tauri/target/debug/bundle/deb/*.deb >/dev/null

  # コンテナの中ではGPUとWebKitGTKのサンドボックスが使えないため、テストの起動に限って無効にする。
  export WEBKIT_DISABLE_COMPOSITING_MODE=1 WEBKIT_DISABLE_DMABUF_RENDERER=1 WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1
  export JP_DOCS_STUDIO_DESKTOP_EXECUTABLE=/usr/bin/jp-docs-studio-desktop
  # xvfb-run は PID 1 の下だと Xvfb の準備完了を待ち続けるため、Xvfb を直接起動する。
  Xvfb :99 -screen 0 1440x900x24 -nolisten tcp &
  export DISPLAY=:99
  sleep 2
  dbus-run-session -- node tests/desktop/run.mjs
'
