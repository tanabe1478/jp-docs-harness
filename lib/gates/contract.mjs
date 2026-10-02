import { createHash } from "node:crypto";
import path from "node:path";
import { inspectContractConfirmation } from "../core/contract-confirmation.mjs";
import {
  createContractValidator,
  loadDocumentContract,
} from "../core/document-contract.mjs";

export const contractGate = {
  id: "contract",
  async run({ cwd, documents, reviewMode, yaml, Ajv, intentSchemaPath }) {
    if (!yaml || !Ajv) throw new Error("Contract gateにはyamlとAjvが必要です");

    const validate = await createContractValidator({ Ajv, intentSchemaPath });
    const updatedDocuments = [];
    const findings = [];

    for (const document of documents) {
      const contractPath = `${document.path}.intent.yml`;
      const contract = await loadDocumentContract({
        absolutePath: path.join(cwd, contractPath),
        relativePath: contractPath,
        yaml,
        validate,
      });

      const confirmation =
        contract.status === "valid"
          ? await inspectContractConfirmation({
              cwd,
              documentPath: document.path,
              contractHash: contract.contractHash,
            })
          : null;

      updatedDocuments.push({
        ...document,
        contract: {
          path: contract.path,
          status: contract.status,
          ...(contract.contractHash ? { contractHash: contract.contractHash } : {}),
          ...(confirmation ? { confirmation: confirmation.status } : {}),
          ...(contract.data?.style ? { style: contract.data.style } : {}),
        },
      });

      // 未確認の契約はAIが本文から逆算しただけの可能性があり、判定基準として独立していない。
      // manualでは状態の表示に留め、契約を求めるモードでだけ指摘にする。
      if (confirmation && confirmation.status !== "confirmed" && reviewMode !== "manual") {
        findings.push(
          createContractFinding({
            document: document.path,
            ruleId: `contract/${confirmation.status}`,
            message:
              confirmation.status === "changed"
                ? `文書契約が書き手の確認後に変更されています: ${contractPath}。review-docsで確認し直してください`
                : `文書契約が書き手に確認されていません: ${contractPath}。review-docsまたはplan-docsで確認してください`,
            resolution: "needs_author",
            repairableByAgent: false,
            location: null,
            severity: reviewMode === "strict" ? "error" : "warning",
          }),
        );
      }

      if (contract.status === "missing" && reviewMode === "strict") {
        findings.push(
          createContractFinding({
            document: document.path,
            ruleId: "contract/missing",
            message: `文書契約がありません: ${contractPath}`,
            resolution: "needs_author",
            repairableByAgent: false,
            location: null,
          }),
        );
      }

      for (const error of contract.errors) {
        findings.push(
          createContractFinding({
            document: document.path,
            ruleId:
              error.kind === "yaml"
                ? "contract/yaml"
                : `contract/schema${error.keyword ? `/${error.keyword}` : ""}`,
            message: error.message,
            resolution: "agent",
            repairableByAgent: true,
            location: error.location,
          }),
        );
      }
    }

    return { documents: updatedDocuments, findings };
  },
};

function createContractFinding({
  document,
  ruleId,
  message,
  resolution,
  repairableByAgent,
  location,
  severity = "error",
}) {
  const idSource = ["contract", document, ruleId, message].join("\0");
  return {
    id: `contract-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "contract",
    document,
    ruleId,
    severity,
    verdict: "fail",
    resolution,
    message,
    location,
    repairableByAgent,
  };
}
