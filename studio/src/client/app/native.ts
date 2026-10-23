import { invoke, isTauri } from "@tauri-apps/api/core";

// ネイティブ版（Tauri）の中で動いているときだけ使える機能。Web 版では null を返す。
export const native = isTauri()
  ? {
      // OS のファイル選択ダイアログで参考資料を選ぶ。登録はネイティブ側が行い、画面には件数だけが返る。
      pickReferences: (documentPath: string) => invoke<number>("pick_references", { documentPath }),
      // ログイン画面などを既定のブラウザで開く。
      openExternal: (url: string) => invoke<void>("open_external", { url }),
      // workspace を選び直す。選ぶとサーバーが起動し直し、画面も読み込み直される。
      chooseWorkspace: () => invoke<boolean>("choose_workspace"),
      // 画面がネイティブ機能へつながったことをネイティブ側に伝える。
      ready: () => invoke<string>("native_ready"),
    }
  : null;

export function openExternal(url: string) {
  if (native) return native.openExternal(url);
  window.open(url, "_blank", "noopener,noreferrer");
  return Promise.resolve();
}
