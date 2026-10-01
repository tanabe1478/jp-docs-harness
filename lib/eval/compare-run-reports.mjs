const LABEL_DIMENSIONS = [
  "rubricVerdict",
  "rubricResolution",
  "accountabilityStatus",
  "groundingCoverage",
  "groundingVerdict",
  "groundingResolution",
  "excessCoverage",
];

const EXTRACTION_DIMENSIONS = ["groundingExtraction", "excessExtraction"];

export function compareRunReports(baseline, candidate) {
  assertRunReport(baseline, "baseline");
  assertRunReport(candidate, "candidate");
  return {
    schemaVersion: 1,
    corpus: {
      baselineEvaluatedCases: baseline.corpus.evaluatedCases,
      candidateEvaluatedCases: candidate.corpus.evaluatedCases,
      sameExpectedCases: baseline.corpus.expectedCases === candidate.corpus.expectedCases,
    },
    dimensions: {
      ...Object.fromEntries(
        LABEL_DIMENSIONS.map((name) => [
          name,
          metricDelta(baseline.dimensions[name].accuracy, candidate.dimensions[name].accuracy),
        ]),
      ),
      ...Object.fromEntries(
        EXTRACTION_DIMENSIONS.map((name) => [
          name,
          {
            precision: metricDelta(baseline.dimensions[name].precision, candidate.dimensions[name].precision),
            recall: metricDelta(baseline.dimensions[name].recall, candidate.dimensions[name].recall),
          },
        ]),
      ),
    },
  };
}

function metricDelta(baseline, candidate) {
  return {
    baseline,
    candidate,
    delta:
      baseline === null || candidate === null
        ? null
        : Number((candidate - baseline).toFixed(4)),
  };
}

function assertRunReport(report, label) {
  if (!report?.corpus || !report?.dimensions) throw new Error(`${label}がeval-suite reportではありません`);
  for (const name of [...LABEL_DIMENSIONS, ...EXTRACTION_DIMENSIONS]) {
    if (!report.dimensions[name]) throw new Error(`${label}.dimensions.${name}がありません`);
  }
}
