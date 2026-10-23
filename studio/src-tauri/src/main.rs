// リリースビルドの Windows で余分なコンソールを出さない。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    jp_docs_studio_desktop::run();
}
