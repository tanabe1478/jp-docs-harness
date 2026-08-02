export function compareReviewResults(gold, candidate) {
  assertComparable(gold, "gold");
  assertComparable(candidate, "candidate");
  return {
    schemaVersion: 1,
    dimensions: {
      rubricVerdict: compareDimension({
        gold: gold.evaluations,
        candidate: candidate.evaluations,
        key: (item) => item.checkId,
        value: (item) => item.verdict,
      }),
      rubricResolution: compareDimension({
        gold: gold.evaluations,
        candidate: candidate.evaluations,
        key: (item) => item.checkId,
        value: (item) => item.resolution,
      }),
      accountabilityStatus: compareDimension({
        gold: gold.authorEvaluations,
        candidate: candidate.authorEvaluations,
        key: (item) => item.item,
        value: (item) => item.status,
      }),
      groundingCoverage: compareDimension({
        gold: [gold.groundingCoverage],
        candidate: [candidate.groundingCoverage],
        key: () => "document",
        value: (item) => item.status,
      }),
      groundingExtraction: compareExtraction({
        gold: gold.claimEvaluations,
        candidate: candidate.claimEvaluations,
        key: claimKey,
      }),
      groundingVerdict: compareDimension({
        gold: gold.claimEvaluations,
        candidate: candidate.claimEvaluations,
        key: claimKey,
        value: (item) => item.verdict,
      }),
      groundingResolution: compareDimension({
        gold: gold.claimEvaluations,
        candidate: candidate.claimEvaluations,
        key: claimKey,
        value: (item) => item.resolution,
      }),
    },
  };
}

function assertComparable(result, label) {
  for (const field of ["evaluations", "authorEvaluations", "claimEvaluations"]) {
    if (!Array.isArray(result?.[field])) throw new Error(`${label}.${field}が配列ではありません`);
  }
  if (!result.groundingCoverage?.status) {
    throw new Error(`${label}.groundingCoverage.statusがありません`);
  }
}

function compareDimension({ gold, candidate, key, value }) {
  const goldMap = uniqueMap(gold, key, "gold");
  const candidateMap = uniqueMap(candidate, key, "candidate");
  const expectedKeys = [...goldMap.keys()];
  const candidateKeys = [...candidateMap.keys()];
  const shared = expectedKeys.filter((itemKey) => candidateMap.has(itemKey));
  const mismatches = shared
    .filter((itemKey) => value(goldMap.get(itemKey)) !== value(candidateMap.get(itemKey)))
    .map((itemKey) => ({
      key: itemKey,
      expected: value(goldMap.get(itemKey)),
      actual: value(candidateMap.get(itemKey)),
    }));
  const correct = shared.length - mismatches.length;

  return {
    expected: expectedKeys.length,
    produced: candidateKeys.length,
    compared: shared.length,
    correct,
    accuracy: ratio(correct, expectedKeys.length),
    missing: expectedKeys.filter((itemKey) => !candidateMap.has(itemKey)),
    unexpected: candidateKeys.filter((itemKey) => !goldMap.has(itemKey)),
    mismatches,
  };
}

function compareExtraction({ gold, candidate, key }) {
  const goldKeys = new Set(gold.map(key));
  const candidateKeys = new Set(candidate.map(key));
  const matched = [...goldKeys].filter((itemKey) => candidateKeys.has(itemKey)).length;
  return {
    expected: goldKeys.size,
    produced: candidateKeys.size,
    matched,
    precision: ratio(matched, candidateKeys.size),
    recall: ratio(matched, goldKeys.size),
    missing: [...goldKeys].filter((itemKey) => !candidateKeys.has(itemKey)),
    unexpected: [...candidateKeys].filter((itemKey) => !goldKeys.has(itemKey)),
  };
}

function claimKey(claim) {
  const location = claim.location
    ? `${claim.location.startLine}-${claim.location.endLine}`
    : "no-location";
  return `${location}:${claim.text}`;
}

function uniqueMap(items, key, label) {
  const map = new Map();
  for (const item of items) {
    const itemKey = key(item);
    if (map.has(itemKey)) throw new Error(`${label}に重複した評価キーがあります: ${itemKey}`);
    map.set(itemKey, item);
  }
  return map;
}

function ratio(numerator, denominator) {
  if (denominator === 0) return null;
  return Number((numerator / denominator).toFixed(4));
}
