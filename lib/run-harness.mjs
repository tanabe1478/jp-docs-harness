import { createHarnessReport } from "./core/report.mjs";
import { resolveTargetPatterns } from "./core/target-files.mjs";
import { surfaceGate } from "./gates/surface.mjs";

export async function runHarness({
  textlint,
  cwd,
  configFilePath,
  nodeModulesDir,
  files = [],
  gates = [surfaceGate],
}) {
  const patterns = resolveTargetPatterns({ cwd, files });
  const gateResults = [];

  for (const gate of gates) {
    gateResults.push(
      await gate.run({
        textlint,
        cwd,
        configFilePath,
        nodeModulesDir,
        patterns,
      }),
    );
  }

  const documentsByPath = new Map();
  for (const result of gateResults) {
    for (const document of result.documents ?? []) documentsByPath.set(document.path, document);
  }
  const findings = gateResults.flatMap((result) => result.findings ?? []);
  const report = createHarnessReport({ documents: [...documentsByPath.values()], findings });
  const humanOutput = gateResults.map((result) => result.humanOutput).filter(Boolean).join("\n");

  return {
    report,
    humanOutput,
    hasFindings: report.findings.length > 0,
  };
}
