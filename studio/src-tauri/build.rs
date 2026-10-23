fn main() {
    // 画面（127.0.0.1 から読み込むページ）から呼べるアプリ独自のコマンド。権限は capabilities で絞る。
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "pick_references",
            "open_external",
            "choose_workspace",
            "native_ready",
        ]),
    ))
    .expect("tauri-build に失敗しました");
}
