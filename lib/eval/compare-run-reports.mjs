const LABEL_DIMENSIONS = [
  "rubricVerdict",
  "rubricResolution",
  "accountabilityStatus",
  "groundingCoverage",
  "groundingVerdict",
  "groundingResolution",
];

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
      groundingExtraction: {
        precision: metricDelta(
          baseline.dimensions.groundingExtraction.precision,
          candidate.dimensions.groundingExtraction.precision,
        ),
        recall: metricDelta(
          baseline.dimensions.groundingExtraction.recall,
          candidate.dimensions.groundingExtraction.recall,
        ),
      },
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
  for (const name of [...LABEL_DIMENSIONS, "groundingExtraction"]) {
    if (!report.dimensions[name]) throw new Error(`${label}.dimensions.${name}がありません`);
  }
}
