import { createHash } from "node:crypto";
import { prepareReviewPackets } from "../semantic/prepare-review.mjs";
import { inspectStoredReview } from "../semantic/review-result.mjs";

export const semanticResultGate = {
  id: "semantic-result",
  async run({ cwd, documents, yaml, Ajv, intentSchemaPath, reviewResultSchemaPath }) {
    const findings = [];

    for (const document of documents) {
      if (document.review?.status !== "fresh") continue;

      const [packet] = await prepareReviewPackets({
        cwd,
        files: [document.path],
        yaml,
        Ajv,
        intentSchemaPath,
      });
      const review = await inspectStoredReview({
        cwd,
        packet,
        Ajv,
        reviewResultSchemaPath,
      });
      if (review.status !== "fresh") continue;

      const checksById = new Map(packet.rubric.checks.map((check) => [check.id, check]));
      for (const evaluation of review.result.evaluations) {
        if (evaluation.verdict === "meets") continue;
        const check = checksById.get(evaluation.checkId);
        findings.push(createEvaluationFinding(document.path, check, evaluation));
      }

      for (const evaluation of review.result.authorEvaluations) {
        if (evaluation.status === "provided") continue;
        findings.push(createAuthorFinding(document.path, evaluation));
      }

      for (const evaluation of review.result.claimEvaluations) {
        if (["supported", "not_applicable"].includes(evaluation.verdict)) continue;
        findings.push(createGroundingFinding(document.path, evaluation));
      }
    }

    return {
      documents,
      findings,
      humanOutput: formatSemanticFindings(findings),
    };
  },
};

function createEvaluationFinding(document, check, evaluation) {
  const severity = semanticSeverity(check.importance, evaluation.verdict);
  const ruleId = `semantic/${evaluation.checkId}`;
  return createFinding({
    document,
    ruleId,
    severity,
    verdict: evaluation.verdict,
    resolution: evaluation.resolution,
    message: `${check.criterion} ${evaluation.justification}`,
    location: normalizeLocation(evaluation.location),
    repairableByAgent: evaluation.repairableByAgent,
  });
}

function createGroundingFinding(document, evaluation) {
  const isAuthorClaim = evaluation.kind === "author-experience";
  const severity =
    evaluation.verdict === "conflicts" || isAuthorClaim
      ? "error"
      : evaluation.verdict === "unsupported"
        ? "warning"
        : "info";
  return createFinding({
    document,
    ruleId: `grounding/${evaluation.claimId}`,
    severity,
    verdict:
      evaluation.verdict === "conflicts"
        ? "contradicts"
        : evaluation.verdict === "partially_supported"
          ? "partially_meets"
          : "missing",
    resolution: isAuthorClaim ? "needs_author" : evaluation.resolution,
    message: `主張「${evaluation.text}」: ${evaluation.justification}`,
    location: normalizeLocation(evaluation.location),
    repairableByAgent: isAuthorClaim ? false : evaluation.repairableByAgent,
  });
}

function createAuthorFinding(document, evaluation) {
  return createFinding({
    document,
    ruleId: `accountability/${stableSuffix(evaluation.item)}`,
    severity: evaluation.status === "missing" ? "error" : "warning",
    verdict: evaluation.status === "missing" ? "missing" : "partially_meets",
    resolution: evaluation.status === "missing" ? "needs_author" : "uncertain",
    message: `書き手の入力「${evaluation.item}」: ${evaluation.justification}`,
    location: normalizeLocation(evaluation.location),
    repairableByAgent: false,
  });
}

function createFinding(fields) {
  const idSource = [fields.ruleId, fields.document, fields.message].join("\0");
  return {
    id: `semantic-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "semantic-result",
    ...fields,
  };
}

function semanticSeverity(importance, verdict) {
  if (verdict === "contradicts" || importance === "answer-critical") return "error";
  if (importance === "valuable") return "warning";
  return "info";
}

function normalizeLocation(location) {
  if (!location) return null;
  return {
    startLine: location.startLine,
    startColumn: 1,
    endLine: location.endLine,
    endColumn: 1,
  };
}

function stableSuffix(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function formatSemanticFindings(findings) {
  return findings
    .map((finding) => {
      const location = finding.location ? `:${finding.location.startLine}` : "";
      return `${finding.document}${location} ${finding.message} (${finding.ruleId})`;
    })
    .join("\n");
}
