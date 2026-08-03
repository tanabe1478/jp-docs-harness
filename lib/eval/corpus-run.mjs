import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compareReviewResults } from "./compare-review-results.mjs";

export async function listCorpusCases(corpusRoot) {
  const entries = await readdir(corpusRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function prepareCorpusRun({
  cwd,
  corpusRoot,
  outputDir,
  prepareReviewPackets,
  yaml,
  Ajv,
  intentSchemaPath,
}) {
  const caseIds = await listCorpusCases(corpusRoot);
  await mkdir(outputDir, { recursive: true });
  const cases = [];

  for (const caseId of caseIds) {
    const documentPath = path.relative(cwd, path.join(corpusRoot, caseId, "document.md"));
    const [packet] = await prepareReviewPackets({
      cwd,
      files: [documentPath],
      yaml,
      Ajv,
      intentSchemaPath,
    });
    const packetFile = `${caseId}.packet.json`;
    const candidateFile = `${caseId}.json`;
    await writeFile(path.join(outputDir, packetFile), `${JSON.stringify(packet, null, 2)}\n`);
    cases.push({ id: caseId, packetFile, candidateFile });
  }

  const manifest = {
    schemaVersion: 1,
    promptVersion: "2",
    cases,
  };
  await writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function evaluateCorpusRun({
  corpusRoot,
  candidateDir,
  validateResult,
  inspectCandidate,
}) {
  const caseIds = await listCorpusCases(corpusRoot);
  const cases = [];
  const missingCases = [];
  const judges = new Map();
  const invalidCases = [];

  for (const caseId of caseIds) {
    const candidatePath = path.join(candidateDir, `${caseId}.json`);
    if (!existsSync(candidatePath)) {
      missingCases.push(caseId);
      continue;
    }
    const gold = JSON.parse(await readFile(path.join(corpusRoot, caseId, "gold.json"), "utf8"));
    const candidate = JSON.parse(await readFile(candidatePath, "utf8"));
    if (validateResult && !validateResult(candidate)) {
      const details = (validateResult.errors ?? [])
        .map((error) => `${error.instancePath || "/"} ${error.message ?? "Schema違反"}`)
        .join("; ");
      throw new Error(`${caseId}: candidateが無効です: ${details}`);
    }
    const artifactErrors = inspectCandidate
      ? await inspectCandidate({ caseId, candidate, candidateDir })
      : [];
    if (artifactErrors.length > 0) invalidCases.push(caseId);
    const comparison = compareReviewResults(gold, candidate);
    cases.push({ id: caseId, artifactErrors, dimensions: comparison.dimensions });
    const judgeKey = [candidate.judge.provider, candidate.judge.model, candidate.judge.promptVersion].join("/");
    judges.set(judgeKey, (judges.get(judgeKey) ?? 0) + 1);
  }

  return {
    schemaVersion: 1,
    corpus: {
      expectedCases: caseIds.length,
      evaluatedCases: cases.length,
      missingCases,
      invalidCases,
      mixedJudges: judges.size > 1,
    },
    judges: [...judges.entries()].map(([judge, count]) => ({ judge, count })),
    dimensions: aggregateDimensions(cases),
    cases,
  };
}

function aggregateDimensions(cases) {
  const names = [
    "rubricVerdict",
    "rubricResolution",
    "accountabilityStatus",
    "groundingCoverage",
    "groundingExtraction",
    "groundingVerdict",
    "groundingResolution",
  ];
  return Object.fromEntries(
    names.map((name) => {
      const values = cases.map((item) => item.dimensions[name]);
      return [name, name === "groundingExtraction" ? aggregateExtraction(values) : aggregateLabels(values)];
    }),
  );
}

function aggregateLabels(values) {
  const expected = sum(values, "expected");
  const produced = sum(values, "produced");
  const compared = sum(values, "compared");
  const correct = sum(values, "correct");
  return {
    expected,
    produced,
    compared,
    correct,
    accuracy: ratio(correct, expected),
    missing: values.reduce((total, value) => total + value.missing.length, 0),
    unexpected: values.reduce((total, value) => total + value.unexpected.length, 0),
    mismatches: values.reduce((total, value) => total + value.mismatches.length, 0),
  };
}

function aggregateExtraction(values) {
  const expected = sum(values, "expected");
  const produced = sum(values, "produced");
  const matched = sum(values, "matched");
  return {
    expected,
    produced,
    matched,
    precision: ratio(matched, produced),
    recall: ratio(matched, expected),
    missing: values.reduce((total, value) => total + value.missing.length, 0),
    unexpected: values.reduce((total, value) => total + value.unexpected.length, 0),
  };
}

function sum(values, field) {
  return values.reduce((total, value) => total + value[field], 0);
}

function ratio(numerator, denominator) {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}
