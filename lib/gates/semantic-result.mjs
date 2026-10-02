import { createHash } from "node:crypto";
import { prepareReviewPackets } from "../semantic/prepare-review.mjs";
import { inspectStoredReview } from "../semantic/review-result.mjs";

const EXCESS_LABELS = {
  restatement: "既出の言い直し",
  "context-implied": "文脈から分かる語の再明示",
  "audience-known": "読者が知っている内容の説明",
  "off-contract": "契約のどの目的にも寄与しない記述",
};

// 先行箇所や契約から余分さを確かめられる種類だけ警告にする。
// 語句単位の再明示は読む負担が小さく、契約外の記述は契約側の漏れの可能性があるため情報に留める。
const EXCESS_SEVERITY = {
  restatement: "warning",
  "context-implied": "info",
  "audience-known": "warning",
  "off-contract": "info",
};

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

      const documentFindings = [];
      const checksById = new Map(packet.rubric.checks.map((check) => [check.id, check]));
      for (const evaluation of review.result.evaluations) {
        if (evaluation.verdict === "meets") continue;
        const check = checksById.get(evaluation.checkId);
        documentFindings.push(createEvaluationFinding(document.path, check, evaluation));
      }

      for (const evaluation of review.result.authorEvaluations) {
        if (evaluation.status === "provided") continue;
        documentFindings.push(createAuthorFinding(document.path, evaluation));
      }

      for (const evaluation of review.result.claimEvaluations) {
        if (["supported", "not_applicable"].includes(evaluation.verdict)) continue;
        documentFindings.push(createGroundingFinding(document.path, evaluation));
      }

      for (const evaluation of review.result.excessEvaluations) {
        documentFindings.push(createExcessFinding(document.path, evaluation));
      }

      // 書き手が確認していない契約に基づく判定は、契約が本文の要約にすぎない可能性がある。
      // 判定を捨てずに、基準の出どころが未確認であることを読み手に示す。
      const unconfirmed = document.contract?.confirmation !== "confirmed";
      findings.push(
        ...documentFindings.map((finding) =>
          unconfirmed ? { ...finding, message: `（未確認の契約に基づく）${finding.message}` } : finding,
        ),
      );
    }

    return { documents, findings };
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

function createExcessFinding(document, evaluation) {
  const reference = evaluation.relatedLocation
    ? `（${evaluation.relatedLocation.startLine}行目「${evaluation.relatedText}」）`
    : evaluation.knownItem
      ? `（読者が知っていること「${evaluation.knownItem}」）`
      : "";
  return createFinding({
    document,
    ruleId: `excess/${evaluation.excessId}`,
    severity: EXCESS_SEVERITY[evaluation.kind],
    verdict: "fail",
    resolution: evaluation.resolution,
    message: `${EXCESS_LABELS[evaluation.kind]}「${evaluation.text}」${reference}: ${evaluation.justification}`,
    location: normalizeLocation(evaluation.location),
    repairableByAgent: evaluation.repairableByAgent,
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
