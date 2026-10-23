// デスクトップ版（Tauri）に同梱する実行環境を src-tauri/runtime と src-tauri/binaries に組み立てる。
// - runtime/app/studio: Studio のサーバー（TypeScript のまま）と、ビルド済みの画面、本番用の依存
// - runtime/app:        jp-docs-harness の CLI（bin, lib, schemas）と本番用の依存（textlint など）
// - binaries/node-<target>: この Node 本体。Studio のサーバーと検査の CLI をこれで動かす
// 使い方: npm run build の後に node scripts/stage-desktop.mjs
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, chmodSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const studio = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repository = path.resolve(studio, "..");
const tauri = path.join(studio, "src-tauri");
const runtime = path.join(tauri, "runtime");
const app = path.join(runtime, "app");

if (!existsSync(path.join(studio, "dist", "client", "index.html"))) {
  throw new Error("画面のビルドがありません。先に npm run build を実行してください");
}

rmSync(runtime, { recursive: true, force: true });
mkdirSync(path.join(app, "studio"), { recursive: true });

function copy(from, to) {
  cpSync(from, to, { recursive: true, dereference: true });
}

function installProduction(directory) {
  // lockfile どおりに、本番用の依存だけを入れる。インストール時のスクリプトは実行しない。
  // Windows の npm は npm.cmd で、Node 22 では .cmd をシェルなしで起動できない。引数は固定の文字列だけ。
  const windows = process.platform === "win32";
  execFileSync(windows ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: directory,
    stdio: "inherit",
    shell: windows,
  });
}

// Studio
for (const entry of ["src/server", "src/shared", "dist/client", "package.json", "package-lock.json"]) {
  copy(path.join(studio, entry), path.join(app, "studio", entry));
}
installProduction(path.join(app, "studio"));

// jp-docs-harness 本体（検査の CLI）
for (const entry of ["bin", "lib", "schemas", ".textlintrc.json", ".textlintrc.no-ai-words.json", "package.json", "package-lock.json"]) {
  copy(path.join(repository, entry), path.join(app, entry));
}
installProduction(app);

// Node 本体。Tauri の externalBin は「名前-ターゲット」のファイル名を求める。
const target = /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))?.[1];
if (!target) throw new Error("rustc からターゲットを判定できません");
const binaries = path.join(tauri, "binaries");
mkdirSync(binaries, { recursive: true });
const extension = process.platform === "win32" ? ".exe" : "";
const nodeBinary = path.join(binaries, `node-${target}${extension}`);
copyFileSync(process.execPath, nodeBinary);
chmodSync(nodeBinary, 0o755);

process.stdout.write(`同梱する実行環境を用意しました: ${runtime}\nNode: ${process.version} → ${nodeBinary}\n`);
