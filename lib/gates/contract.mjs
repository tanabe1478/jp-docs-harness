import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { hashContent } from "../core/content-hash.mjs";

export const contractGate = {
  id: "contract",
  async run({ cwd, documents, reviewMode, yaml, Ajv, intentSchemaPath }) {
    if (!yaml || !Ajv) throw new Error("Contract gateにはyamlとAjvが必要です");

    const schema = JSON.parse(await readFile(intentSchemaPath, "utf8"));
    const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
    const updatedDocuments = [];
    const findings = [];

    for (const document of documents) {
      const contractPath = `${document.path}.intent.yml`;
      const absoluteContractPath = path.join(cwd, contractPath);

      if (!existsSync(absoluteContractPath)) {
        updatedDocuments.push({
          ...document,
          contract: { path: contractPath, status: "missing" },
        });
        if (reviewMode === "strict") {
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
        continue;
      }

      const source = await readFile(absoluteContractPath, "utf8");
      const lineCounter = new yaml.LineCounter();
      const parsed = yaml.parseDocument(source, { lineCounter });
      const contractHash = hashContent(source);

      if (parsed.errors.length > 0) {
        updatedDocuments.push({
          ...document,
          contract: { path: contractPath, status: "invalid", contractHash },
        });
        for (const error of parsed.errors) {
          const position = error.linePos?.[0];
          findings.push(
            createContractFinding({
              document: document.path,
              ruleId: "contract/yaml",
              message: error.message,
              resolution: "agent",
              repairableByAgent: true,
              location: position
                ? pointLocation(position.line, position.col)
                : pointLocation(1, 1),
            }),
          );
        }
        continue;
      }

      const contract = parsed.toJS();
      const valid = validate(contract);
      updatedDocuments.push({
        ...document,
        contract: {
          path: contractPath,
          status: valid ? "valid" : "invalid",
          contractHash,
        },
      });

      if (!valid) {
        for (const error of validate.errors ?? []) {
          const location = locateYamlPath(parsed, lineCounter, error.instancePath);
          findings.push(
            createContractFinding({
              document: document.path,
              ruleId: `contract/schema${error.keyword ? `/${error.keyword}` : ""}`,
              message: `${error.instancePath || "/"} ${error.message ?? "契約がSchemaに適合しません"}`,
              resolution: "agent",
              repairableByAgent: true,
              location,
            }),
          );
        }
      }
    }

    return {
      documents: updatedDocuments,
      findings,
      humanOutput: formatContractFindings(findings),
    };
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

function locateYamlPath(document, lineCounter, instancePath) {
  const parts = instancePath
    .split("/")
    .filter(Boolean)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const node = parts.length > 0 ? document.getIn(parts, true) : document.contents;
  const offset = node?.range?.[0];
  if (typeof offset !== "number") return pointLocation(1, 1);
  const position = lineCounter.linePos(offset);
  return pointLocation(position.line, position.col);
}

function pointLocation(line, column) {
  return { startLine: line, startColumn: column, endLine: line, endColumn: column };
}

function formatContractFindings(findings) {
  if (findings.length === 0) return "";
  return findings
    .map((finding) => {
      const position = finding.location
        ? `${finding.location.startLine}:${finding.location.startColumn}`
        : "-";
      return `${finding.document}:${position} ${finding.message} (${finding.ruleId})`;
    })
    .join("\n");
}
