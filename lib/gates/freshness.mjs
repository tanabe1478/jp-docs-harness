import { createHash } from "node:crypto";
import path from "node:path";
import { prepareReviewPackets } from "../semantic/prepare-review.mjs";
import { inspectStoredReview } from "../semantic/review-result.mjs";

export const freshnessGate = {
  id: "freshness",
  async run({ cwd, documents, reviewMode, yaml, Ajv, intentSchemaPath, reviewResultSchemaPath }) {
    const updatedDocuments = [];
    const findings = [];

    for (const document of documents) {
      if (document.contract?.status !== "valid") {
        updatedDocuments.push(document);
        continue;
      }

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
      const relativeReviewPath = path.relative(cwd, review.reviewPath).split(path.sep).join("/");
      updatedDocuments.push({
        ...document,
        review: { path: relativeReviewPath, status: review.status },
      });

      if (review.status === "fresh") continue;
      if (review.status === "missing" && reviewMode === "manual") continue;

      const severity = reviewMode === "manual" ? "warning" : "error";
      findings.push(
        createFreshnessFinding({
          document: document.path,
          status: review.status,
          severity,
          message: freshnessMessage(review.status, relativeReviewPath, review.reasons),
        }),
      );
    }

    return {
      documents: updatedDocuments,
      findings,
      humanOutput: formatFreshnessFindings(findings),
    };
  },
};

function createFreshnessFinding({ document, status, severity, message }) {
  const ruleId = `freshness/${status}`;
  const idSource = ["freshness", document, ruleId, message].join("\0");
  return {
    id: `freshness-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "freshness",
    document,
    ruleId,
    severity,
    verdict: status === "missing" ? "missing" : "fail",
    resolution: "agent",
    message,
    location: null,
    repairableByAgent: true,
  };
}

function freshnessMessage(status, reviewPath, reasons) {
  if (status === "missing") return `意味レビューがありません: ${reviewPath}`;
  if (status === "stale") return `意味レビューが古くなっています: ${reviewPath}`;
  return `意味レビューが無効です: ${reviewPath}${reasons.length ? `: ${reasons.join("; ")}` : ""}`;
}

function formatFreshnessFindings(findings) {
  return findings.map((finding) => `${finding.document} ${finding.message} (${finding.ruleId})`).join("\n");
}
