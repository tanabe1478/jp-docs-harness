import path from "node:path";
import { createHarnessReport } from "./core/report.mjs";
import { resolveTargetPatterns } from "./core/target-files.mjs";
import { contractGate } from "./gates/contract.mjs";
import { evidenceGate } from "./gates/evidence.mjs";
import { freshnessGate } from "./gates/freshness.mjs";
import { semanticResultGate } from "./gates/semantic-result.mjs";
import { surfaceGate } from "./gates/surface.mjs";

export async function runHarness({
  textlint,
  yaml,
  Ajv,
  cwd,
  configFilePath,
  nodeModulesDir,
  intentSchemaPath = path.join(path.dirname(configFilePath), "schemas", "intent.schema.json"),
  reviewResultSchemaPath = path.join(
    path.dirname(configFilePath),
    "schemas",
    "review-result.schema.json",
  ),
  files = [],
  reviewMode = "manual",
  gates = [surfaceGate, contractGate, evidenceGate, freshnessGate, semanticResultGate],
}) {
  if (!["manual", "contracted", "strict"].includes(reviewMode)) {
    throw new Error(`不明なreview modeです: ${reviewMode}`);
  }

  const patterns = resolveTargetPatterns({ cwd, files });
  const documentsByPath = new Map();
  const findings = [];
  const humanOutputs = [];

  for (const gate of gates) {
    const result = await gate.run({
      textlint,
      yaml,
      Ajv,
      cwd,
      configFilePath,
      nodeModulesDir,
      intentSchemaPath,
      reviewResultSchemaPath,
      patterns,
      reviewMode,
      documents: [...documentsByPath.values()],
      findings: [...findings],
    });

    for (const document of result.documents ?? []) documentsByPath.set(document.path, document);
    findings.push(...(result.findings ?? []));
    if (result.humanOutput) humanOutputs.push(result.humanOutput);
  }

  const report = createHarnessReport({ documents: [...documentsByPath.values()], findings });

  return {
    report,
    humanOutput: humanOutputs.join("\n"),
    hasFindings: report.findings.length > 0,
  };
}
