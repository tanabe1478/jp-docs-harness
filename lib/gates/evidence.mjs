import { createHash } from "node:crypto";
import { prepareReviewPackets } from "../semantic/prepare-review.mjs";

export const evidenceGate = {
  id: "evidence",
  async run({ cwd, documents, reviewMode, yaml, Ajv, intentSchemaPath }) {
    const findings = [];

    for (const document of documents) {
      if (document.contract?.status !== "valid") continue;
      const [packet] = await prepareReviewPackets({
        cwd,
        files: [document.path],
        yaml,
        Ajv,
        intentSchemaPath,
      });
      const requiredIds = new Set(
        packet.rubric.checks
          .filter((check) => check.sourcePolicy === "required")
          .flatMap((check) => check.sourceIds),
      );
      for (const source of packet.grounding.sources) {
        if (!requiredIds.has(source.id) || source.status === "loaded") continue;
        findings.push(
          createEvidenceFinding(
            document.path,
            source,
            reviewMode === "manual" ? "warning" : "error",
          ),
        );
      }
    }

    return {
      documents,
      findings,
      humanOutput: findings
        .map((finding) => `${finding.document} ${finding.message} (${finding.ruleId})`)
        .join("\n"),
    };
  },
};

function createEvidenceFinding(document, source, severity) {
  const canSnapshot = ["external", "missing-snapshot", "invalid-snapshot"].includes(source.status);
  const ruleId = `evidence/${source.status}`;
  const message = evidenceMessage(source);
  const idSource = [document, source.id, source.status, message].join("\0");
  return {
    id: `evidence-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "evidence",
    document,
    ruleId,
    severity,
    verdict: "missing",
    resolution: canSnapshot ? "agent" : "needs_author",
    message,
    location: null,
    repairableByAgent: canSnapshot,
  };
}

function evidenceMessage(source) {
  if (source.status === "external") {
    return `必須のURL根拠資料「${source.id}」にsnapshotがありません。snapshotコマンドを実行してください`;
  }
  if (source.status === "missing-snapshot") {
    return `必須のURL根拠資料「${source.id}」のsnapshotファイルがありません`;
  }
  if (source.status === "invalid-snapshot") {
    return `必須のURL根拠資料「${source.id}」のsnapshotハッシュが一致しません`;
  }
  return `必須のローカル根拠資料「${source.id}」がありません`;
}
