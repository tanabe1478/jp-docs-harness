import { existsSync } from "node:fs";
import path from "node:path";

export async function runTextlint({ textlint, cwd, configFilePath, nodeModulesDir }) {
  const descriptor = await textlint.loadTextlintrc({
    configFilePath,
    node_modulesDir: nodeModulesDir,
  });
  const ignoreFilePath = path.join(cwd, ".textlintignore");
  const linter = textlint.createLinter({
    descriptor,
    cwd,
    ignoreFilePath: existsSync(ignoreFilePath) ? ignoreFilePath : undefined,
  });
  const results = await linter.lintFiles(["**/*.md"]);
  const formatter = await textlint.loadLinterFormatter({ formatterName: "stylish" });
  const output = formatter.format(results);
  const hasMessages = results.some((result) => result.messages.length > 0);

  return { output, hasMessages, results };
}
