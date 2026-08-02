import { readFile } from "node:fs/promises";
import path from "node:path";
import { hashContent } from "../core/content-hash.mjs";
import {
  createContractValidator,
  loadDocumentContract,
} from "../core/document-contract.mjs";
import { resolveTargetPatterns } from "../core/target-files.mjs";
import { compileRubric } from "./compile-rubric.mjs";
import { prepareGrounding } from "./prepare-grounding.mjs";

export async function prepareReviewPackets({ cwd, files, yaml, Ajv, intentSchemaPath }) {
  if (!files || files.length === 0) {
    throw new Error("prepareには1件以上のMarkdownファイルを指定してください");
  }

  const documentPaths = resolveTargetPatterns({ cwd, files });
  if (documentPaths.length === 0) {
    throw new Error("prepareの対象となるMarkdownファイルがありません");
  }

  const validate = await createContractValidator({ Ajv, intentSchemaPath });
  const packets = [];

  for (const documentPath of documentPaths) {
    const absoluteDocumentPath = path.join(cwd, documentPath);
    const contractPath = `${documentPath}.intent.yml`;
    const content = await readFile(absoluteDocumentPath, "utf8");
    const contract = await loadDocumentContract({
      absolutePath: path.join(cwd, contractPath),
      relativePath: contractPath,
      yaml,
      validate,
    });

    if (contract.status === "missing") {
      throw new Error(`文書契約がありません: ${contractPath}`);
    }
    if (contract.status === "invalid") {
      const details = contract.errors.map((error) => error.message).join("; ");
      throw new Error(`文書契約が無効です: ${contractPath}: ${details}`);
    }

    const rubric = compileRubric(contract.data);
    const grounding = await prepareGrounding({ cwd, evidence: contract.data.evidence });
    packets.push({
      schemaVersion: 2,
      document: {
        path: documentPath,
        contentHash: hashContent(content),
        content,
      },
      contract: {
        path: contractPath,
        contractHash: contract.contractHash,
        profile: contract.data.profile,
        audience: contract.data.audience,
        readerDelta: contract.data.reader_delta,
        evidence: contract.data.evidence ?? { sources: [], author_only: [] },
        nonGoals: contract.data.non_goals ?? [],
      },
      rubric: {
        rubricHash: hashContent(JSON.stringify(rubric)),
        ...rubric,
      },
      grounding,
    });
  }

  return packets;
}
