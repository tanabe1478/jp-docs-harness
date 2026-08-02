import path from "node:path";
import { createSurfaceFinding } from "../core/finding.mjs";
import { hashFile } from "../core/content-hash.mjs";
import { runTextlint } from "../run-textlint.mjs";

export const surfaceGate = {
  id: "surface",
  async run({ textlint, cwd, configFilePath, nodeModulesDir, patterns }) {
    const result = await runTextlint({
      textlint,
      cwd,
      configFilePath,
      nodeModulesDir,
      patterns,
    });
    const documents = await Promise.all(
      result.results.map(async (documentResult) => ({
        path: relativeDocumentPath(cwd, documentResult.filePath),
        contentHash: await hashFile(documentResult.filePath),
      })),
    );
    const findings = result.results.flatMap((documentResult) => {
      const document = relativeDocumentPath(cwd, documentResult.filePath);
      return documentResult.messages.map((message) => createSurfaceFinding({ document, message }));
    });

    return { documents, findings, humanOutput: result.output };
  },
};

function relativeDocumentPath(cwd, filePath) {
  return path.relative(cwd, filePath).split(path.sep).join("/");
}
