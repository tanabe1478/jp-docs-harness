import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

// OS ごとのアプリデータディレクトリ。JP_DOCS_STUDIO_DATA_DIR で上書きできる。
export function defaultDataRoot(env: NodeJS.ProcessEnv = process.env, platform = process.platform): string {
  if (env.JP_DOCS_STUDIO_DATA_DIR) return path.resolve(env.JP_DOCS_STUDIO_DATA_DIR);
  const home = os.homedir();
  if (platform === "darwin") return path.join(home, "Library", "Application Support", "jp-docs-studio");
  if (platform === "win32") {
    return path.join(env.APPDATA ?? path.join(home, "AppData", "Roaming"), "jp-docs-studio");
  }
  return path.join(env.XDG_DATA_HOME ?? path.join(home, ".local", "share"), "jp-docs-studio");
}

// workspace の実体パスのハッシュで分ける。workspace を移動すると別の保存先になる。
export function workspaceDataDir(dataRoot: string, workspaceRoot: string): string {
  const key = createHash("sha256").update(workspaceRoot, "utf8").digest("hex").slice(0, 32);
  return path.join(dataRoot, "workspaces", key);
}
