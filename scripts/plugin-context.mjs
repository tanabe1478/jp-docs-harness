import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Claude CodeのBashツールにはCLAUDE_PLUGIN_ROOT / CLAUDE_PLUGIN_DATAが
// 渡らないことがある。環境変数は最優先のヒントとして扱い、なければ
// スクリプト自身の位置と既知のインストール規約から解決する。
export function resolvePluginContext({ packageRoot, probe = "yaml" }) {
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? packageRoot;
  const candidates = [
    process.env.CLAUDE_PLUGIN_DATA,
    packageRoot,
    marketplaceDataDir(packageRoot),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const nodeModulesDir = path.join(candidate, "node_modules");
    // createRequireは親ディレクトリへ遡って解決するため、候補直下の
    // node_modulesを条件にして無関係なインストールの誤検出を防ぐ。
    if (!existsSync(nodeModulesDir)) continue;
    const requireFromData = createRequire(path.join(candidate, "package.json"));
    try {
      requireFromData.resolve(probe);
    } catch {
      continue;
    }
    return { pluginRoot, dataRoot: candidate, nodeModulesDir, requireFromData };
  }

  throw new Error(
    `依存パッケージが見つかりません。Claude Codeを再起動して依存関係のインストールを待つか、CLAUDE_PLUGIN_DATAを設定してください。確認した場所: ${candidates.join(", ")}`,
  );
}

// マーケットプレイス経由のインストールでは、依存パッケージは
// <plugins>/data/<plugin名>-<マーケットプレイスディレクトリ名>/ に置かれる。
function marketplaceDataDir(packageRoot) {
  const marketplacesDir = path.dirname(packageRoot);
  if (path.basename(marketplacesDir) !== "marketplaces") return null;
  const pluginJsonPath = path.join(packageRoot, ".claude-plugin", "plugin.json");
  if (!existsSync(pluginJsonPath)) return null;
  try {
    const { name } = JSON.parse(readFileSync(pluginJsonPath, "utf8"));
    if (!name) return null;
    return path.join(
      path.dirname(marketplacesDir),
      "data",
      `${name}-${path.basename(packageRoot)}`,
    );
  } catch {
    return null;
  }
}
