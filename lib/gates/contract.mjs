import { createHash } from "node:crypto";
import path from "node:path";
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

      updatedDocuments.push({
        ...document,
        contract: {
          path: contract.path,
          status: contract.status,
          ...(contract.contractHash ? { contractHash: contract.contractHash } : {}),
        },
      });

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

function createContractFinding({ document, ruleId, message, resolution, repairableByAgent, location }) {
  const idSource = ["contract", document, ruleId, message].join("\0");
  return {
    id: `contract-${createHash("sha256").update(idSource).digest("hex").slice(0, 16)}`,
    gate: "contract",
    document,
    ruleId,
    severity: "error",
    verdict: "fail",
    resolution,
    message,
    location,
    repairableByAgent,
  };
}
