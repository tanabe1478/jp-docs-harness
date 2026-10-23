// デスクトップ版の通しのテスト。debug ビルドのアプリを一時的な workspace とデータ置き場で起動し、
// 実際のウィンドウ（WKWebView）の中で tests/desktop/in-window.js を動かして結果を確かめる。
// 使い方: npx tauri build --debug --bundles app の後に node tests/desktop/run.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const studio = path.resolve(here, "..", "..");
// 既定は macOS の debug ビルド。Linux などでは JP_DOCS_STUDIO_DESKTOP_EXECUTABLE で実行ファイルを指定する。
const executable =
  process.env.JP_DOCS_STUDIO_DESKTOP_EXECUTABLE ??
  path.join(studio, "src-tauri/target/debug/bundle/macos/jp-docs Studio.app/Contents/MacOS/jp-docs-studio-desktop");
const outputDir = path.join(studio, "test-results", "desktop");
const configRoot =
  process.platform === "darwin"
    ? path.join(os.homedir(), "Library/Application Support")
    : (process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"));
const userConfig = path.join(configRoot, "jp.tanabe1478.jp-docs-studio/desktop.json");

if (!existsSync(executable)) throw new Error(`debug ビルドのアプリがありません: ${executable}`);
mkdirSync(outputDir, { recursive: true });

const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "jp-docs-studio-desktop-")));
const first = path.join(base, "ws-first");
const second = path.join(base, "ws-second");
const external = path.join(base, "外部");
const data = path.join(base, "data");
for (const directory of [first, second, external, data]) mkdirSync(directory, { recursive: true });
writeFileSync(path.join(first, "考えるということ.md"), "# 文章を書くということ\n\nしかし、AIと対話することが、いつも思考を深めるとは限らない。\n");
writeFileSync(path.join(second, "二つ目の原稿.md"), "# 二つ目\n");
const externalFile = path.join(external, "外部の資料.md");
writeFileSync(externalFile, "workspace の外にある資料。\n");
const userConfigBefore = existsSync(userConfig) ? statSync(userConfig).mtimeMs : null;

const app = spawn(executable, [], {
  env: {
    ...process.env,
    JP_DOCS_STUDIO_DATA_DIR: data,
    JP_DOCS_STUDIO_E2E_START_WORKSPACE: first,
    JP_DOCS_STUDIO_E2E_WORKSPACE: second,
    JP_DOCS_STUDIO_E2E_PICK_FILES: externalFile,
    JP_DOCS_STUDIO_E2E_SCRIPT: path.join(here, "in-window.js"),
  },
  stdio: "ignore",
});

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
  process.stdout.write(`${condition ? "ok  " : "NG  "} ${message}\n`);
};

async function waitForFile(file, timeout = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (existsSync(file)) return true;
    const errors = [first, second].flatMap((directory) => readdirSync(directory).filter((name) => name.startsWith("e2e-error")).map((name) => path.join(directory, name)));
    if (errors.length > 0) throw new Error(readFileSync(errors[0], "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

async function waitUntil(probe, timeout = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (probe()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function screenshot(name) {
  if (process.platform !== "darwin") return "macOS 以外では撮影しません";
  try {
    const ids = execFileSync("swift", [path.join(here, "window-id.swift"), String(app.pid)], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    if (ids.length === 0) return "ウィンドウが見つかりません";
    const file = path.join(outputDir, name);
    execFileSync("screencapture", ["-x", "-o", "-l", ids[0], file]);
    return file;
  } catch (error) {
    return `撮影できませんでした: ${error.message}`;
  }
}

try {
  check(await waitForFile(path.join(first, "e2e-first.md")), "一つ目の workspace で画面の操作が終わった");
  process.stdout.write(`撮影: ${screenshot("references-native.png")}\n`);
  writeFileSync(path.join(first, "e2e-go.md"), "撮影が終わった合図\n");
  const firstReport = JSON.parse(readFileSync(path.join(first, "e2e-first.md"), "utf8"));
  check(firstReport.native === true, "サーバーがネイティブ版として起動している");
  check(firstReport.tauri === true, "画面から Tauri の IPC が見えている");
  check(firstReport.steps.includes("typed-and-saved"), "ウィンドウの WebView で入力した文が自動保存された");
  check(
    await waitUntil(() => readFileSync(path.join(first, "考えるということ.md"), "utf8").includes("WKWebViewで書いた一文。")),
    "入力した文がファイルに書き込まれた",
  );
  check(firstReport.steps.some((step) => step.startsWith("picked:")), "ファイル選択から外部の参考資料が画面の一覧に出た");

  const workspaces = path.join(data, "workspaces");
  const store = JSON.parse(readFileSync(path.join(workspaces, readdirSync(workspaces)[0], "studio.json"), "utf8"));
  check(
    store.references.some((reference) => reference.kind === "external" && reference.path === externalFile),
    "外部の参考資料がネイティブ側のトークン経由で登録された",
  );

  check(await waitForFile(path.join(second, "e2e-second.md")), "workspace を選び直すと、二つ目の workspace で画面が開き直した");
  const secondReport = JSON.parse(readFileSync(path.join(second, "e2e-second.md"), "utf8"));
  check(secondReport.workspace === "ws-second" && secondReport.native === true, "選び直した workspace でサーバーが起動し直した");
  process.stdout.write(`撮影: ${screenshot("second-workspace-native.png")}\n`);

  const userConfigAfter = existsSync(userConfig) ? statSync(userConfig).mtimeMs : null;
  check(userConfigAfter === userConfigBefore, "テストの起動では利用者の設定ファイルを書き換えない");
} catch (error) {
  failures.push(String(error));
  process.stdout.write(`NG   ${error}\n`);
} finally {
  app.kill("SIGKILL");
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const leftover = execFileSync("ps", ["-eo", "args"], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(base) && line.includes("src/server/main.ts"));
  check(leftover.length === 0, "アプリを強制終了すると、サーバーの Node も終了する");
}

process.stdout.write(failures.length === 0 ? "\nデスクトップ版の通しのテスト: すべて成功\n" : `\nデスクトップ版の通しのテスト: ${failures.length}件失敗\n`);
process.exit(failures.length === 0 ? 0 : 1);
