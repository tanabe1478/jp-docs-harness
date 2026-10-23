//! jp-docs Studio のデスクトップ版。
//!
//! 同梱した Node で Studio のサーバーを 127.0.0.1 に起動し、その画面をウィンドウに表示する。
//! 画面に渡すネイティブ機能は、参考資料のファイル選択、外部ブラウザで URL を開くこと、
//! workspace の選び直しの三つだけ。外部ファイルの参考資料は、このプロセスだけが知るトークンで
//! サーバーへ登録するため、画面の JavaScript からは任意のパスを登録できない。

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

const STARTUP_TIMEOUT: Duration = Duration::from_secs(40);

struct Sidecar {
    child: Child,
    port: u16,
    // 握っておくだけ。このプロセスが終わるとパイプが閉じ、サーバーは --exit-with-stdin で自分から終了する。
    _stdin: ChildStdin,
}

struct Studio {
    sidecar: Mutex<Option<Sidecar>>,
    token: String,
}

#[derive(Serialize, Deserialize, Default)]
struct DesktopSettings {
    workspace: Option<PathBuf>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("desktop.json"))
}

fn load_settings(app: &AppHandle) -> DesktopSettings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save_settings(app: &AppHandle, settings: &DesktopSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(|e| e.to_string())
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("乱数を取得できません");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    Ok(port)
}

/// externalBin で同梱した Node。バンドルでは実行ファイルと同じディレクトリに置かれる。
fn node_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("実行ファイルの場所が分かりません")?;
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    Ok(dir.join(name))
}

fn runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().resource_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("app"))
}

fn log_tail(path: &Path) -> String {
    let text = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(15)..].join("\n")
}

fn start_sidecar(app: &AppHandle, token: &str, workspace: &Path) -> Result<Sidecar, String> {
    let runtime = runtime_dir(app)?;
    let studio = runtime.join("studio");
    let main = studio.join("src").join("server").join("main.ts");
    if !main.exists() {
        return Err(format!(
            "同梱のサーバーが見つかりません: {}",
            main.display()
        ));
    }
    let port = free_port()?;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&log_dir).map_err(|e| e.to_string())?;
    let log_path = log_dir.join("studio-server.log");
    let log = fs::File::create(&log_path).map_err(|e| e.to_string())?;
    let log_err = log.try_clone().map_err(|e| e.to_string())?;

    let mut child = Command::new(node_path()?)
        .arg(&main)
        .arg("--workspace")
        .arg(workspace)
        .arg("--port")
        .arg(port.to_string())
        .arg("--exit-with-stdin")
        .current_dir(&studio)
        .env("JP_DOCS_STUDIO_NATIVE_TOKEN", token)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err))
        .spawn()
        .map_err(|e| format!("サーバーを起動できません: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or("サーバーの標準入力を確保できません")?;

    let started = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "サーバーが終了しました（{status}）\n{}",
                log_tail(&log_path)
            ));
        }
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return Ok(Sidecar {
                child,
                port,
                _stdin: stdin,
            });
        }
        if started.elapsed() > STARTUP_TIMEOUT {
            let _ = child.kill();
            return Err(format!(
                "サーバーの起動が時間内に終わりませんでした\n{}",
                log_tail(&log_path)
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

fn stop_sidecar(state: &Studio) {
    if let Some(mut sidecar) = state.sidecar.lock().unwrap().take() {
        let _ = sidecar.child.kill();
        let _ = sidecar.child.wait();
    }
}

fn studio_url(port: u16) -> Result<url::Url, String> {
    url::Url::parse(&format!("http://127.0.0.1:{port}/")).map_err(|e| e.to_string())
}

/// workspace でサーバーを（起動し直して）立ち上げ、ウィンドウにその画面を表示する。
fn open_workspace(app: &AppHandle, workspace: &Path) -> Result<(), String> {
    let state = app.state::<Studio>();
    stop_sidecar(&state);
    let sidecar = start_sidecar(app, &state.token, workspace)?;
    let url = studio_url(sidecar.port)?;
    *state.sidecar.lock().unwrap() = Some(sidecar);
    let window = app
        .get_webview_window("main")
        .ok_or("ウィンドウが見つかりません")?;
    window.navigate(url).map_err(|e| e.to_string())
}

fn pick_folder(app: &AppHandle) -> Option<PathBuf> {
    app.dialog()
        .file()
        .set_title("執筆に使うフォルダ（workspace）を選ぶ")
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
}

/// 127.0.0.1 のサーバーへ JSON を POST する。外部へは接続しないため、依存を増やさず標準ライブラリで書く。
fn post_json(port: u16, path: &str, token: &str, body: &str) -> Result<(u16, String), String> {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(30))).ok();
    let request = format!(
        "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nx-jp-docs-native-token: {token}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| e.to_string())?;
    let status = response
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or("サーバーの応答を読み取れません")?;
    let body = response
        .split_once("\r\n\r\n")
        .map(|(_, b)| b.to_string())
        .unwrap_or_default();
    Ok((status, body))
}

fn error_message(body: &str) -> String {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|value| value["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| "参考資料を登録できませんでした".to_string())
}

#[tauri::command]
async fn pick_references(
    app: AppHandle,
    state: State<'_, Studio>,
    document_path: String,
) -> Result<usize, String> {
    let picker = app.clone();
    let files = tauri::async_runtime::spawn_blocking(move || {
        picker
            .dialog()
            .file()
            .set_title("参考資料にするファイルを選ぶ")
            .add_filter("Markdown とテキスト", &["md", "markdown", "txt"])
            .blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    let Some(files) = files else { return Ok(0) };
    let paths: Vec<String> = files
        .into_iter()
        .filter_map(|file| file.into_path().ok())
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    if paths.is_empty() {
        return Ok(0);
    }
    let port = state
        .sidecar
        .lock()
        .unwrap()
        .as_ref()
        .map(|s| s.port)
        .ok_or("サーバーが起動していません")?;
    let body = serde_json::json!({ "path": document_path, "files": paths }).to_string();
    let token = state.token.clone();
    let (status, response) = tauri::async_runtime::spawn_blocking(move || {
        post_json(port, "/api/native/references", &token, &body)
    })
    .await
    .map_err(|e| e.to_string())??;
    if status == 201 {
        Ok(paths.len())
    } else {
        Err(error_message(&response))
    }
}

fn validate_external_url(url: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(url).map_err(|_| "URL が不正です".to_string())?;
    if parsed.scheme() != "https" {
        return Err("https の URL だけを開けます".to_string());
    }
    Ok(parsed)
}

/// ログイン画面などを既定のブラウザで開く。https の URL だけを受け付ける。
#[tauri::command]
fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = validate_external_url(&url)?;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn choose_workspace(app: AppHandle) -> Result<bool, String> {
    let picker = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || pick_folder(&picker))
        .await
        .map_err(|e| e.to_string())?;
    let Some(workspace) = chosen else {
        return Ok(false);
    };
    let target = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        save_settings(
            &target,
            &DesktopSettings {
                workspace: Some(workspace.clone()),
            },
        )?;
        open_workspace(&target, &workspace)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(true)
}

/// 画面がネイティブ機能へつながったことを記録する。権限設定が効いているかの確認にも使う。
#[tauri::command]
fn native_ready(app: AppHandle) -> Result<String, String> {
    let version = app.package_info().version.to_string();
    if let Ok(dir) = app.path().app_log_dir() {
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(
            dir.join("native-bridge.log"),
            format!("native bridge connected (version {version})\n"),
        );
    }
    Ok(version)
}

fn fail(app: &AppHandle, message: &str) {
    app.dialog()
        .message(message)
        .title("jp-docs Studio を起動できません")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    app.exit(1);
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Studio {
            sidecar: Mutex::new(None),
            token: random_token(),
        })
        .invoke_handler(tauri::generate_handler![
            pick_references,
            open_external,
            choose_workspace,
            native_ready
        ])
        .setup(|app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("jp-docs Studio")
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 640.0)
                .build()?;

            // ダイアログは待ちを伴うため、メインスレッドの外で workspace を決めてサーバーを起動する。
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let saved = load_settings(&handle)
                    .workspace
                    .filter(|path| path.is_dir());
                let workspace = match saved.or_else(|| pick_folder(&handle)) {
                    Some(path) => path,
                    None => {
                        handle.exit(0);
                        return;
                    }
                };
                if let Err(error) = save_settings(
                    &handle,
                    &DesktopSettings {
                        workspace: Some(workspace.clone()),
                    },
                ) {
                    fail(&handle, &format!("設定を保存できません: {error}"));
                    return;
                }
                if let Err(error) = open_workspace(&handle, &workspace) {
                    fail(&handle, &error);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("アプリを初期化できません");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            stop_sidecar(&handle.state::<Studio>());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn external_urls_must_be_https() {
        assert!(
            validate_external_url("https://auth.openai.com/api/accounts/authorize?x=1").is_ok()
        );
        assert!(validate_external_url("http://example.com/").is_err());
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("not a url").is_err());
    }

    #[test]
    fn post_json_sends_token_and_reads_status_and_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut buffer = [0u8; 4096];
            let size = stream.read(&mut buffer).unwrap();
            let request = String::from_utf8_lossy(&buffer[..size]).to_string();
            stream
                .write_all("HTTP/1.1 403 Forbidden\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"error\":{\"message\":\"拒否\"}}".as_bytes())
                .unwrap();
            request
        });
        let (status, body) = post_json(
            port,
            "/api/native/references",
            "secret",
            "{\"path\":\"a.md\"}",
        )
        .unwrap();
        let request = server.join().unwrap();
        assert_eq!(status, 403);
        assert_eq!(error_message(&body), "拒否");
        assert!(request.starts_with("POST /api/native/references HTTP/1.1\r\n"));
        assert!(request.contains("x-jp-docs-native-token: secret\r\n"));
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}\r\n")));
        assert!(request.ends_with("{\"path\":\"a.md\"}"));
    }

    #[test]
    fn error_message_falls_back_when_body_is_not_json() {
        assert_eq!(error_message("oops"), "参考資料を登録できませんでした");
    }

    #[test]
    fn tokens_are_random_hex() {
        let a = random_token();
        let b = random_token();
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
}
