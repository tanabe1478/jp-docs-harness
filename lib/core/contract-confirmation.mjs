import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatContractSummary } from "./contract-summary.mjs";
import { createContractValidator, loadDocumentContract } from "./document-contract.mjs";
import { resolveTargetPatterns } from "./target-files.mjs";

export const CONTRACT_CONFIRMATION_SCHEMA_VERSION = 1;

export function getContractConfirmationPath(cwd, documentPath) {
  return path.join(cwd, ".jp-docs-harness", "contracts", `${documentPath}.confirmation.json`);
}

// 確認は契約の内容ハッシュに結び付ける。確認後に契約を書き換えると、
// 書き手が見ていない内容になるため確認は外れる。
export async function inspectContractConfirmation({ cwd, documentPath, contractHash }) {
  const confirmationPath = getContractConfirmationPath(cwd, documentPath);
  if (!existsSync(confirmationPath)) return { status: "unconfirmed", confirmationPath };

  let record;
  try {
    record = JSON.parse(await readFile(confirmationPath, "utf8"));
  } catch {
    return { status: "unconfirmed", confirmationPath };
  }
  if (
    record?.schemaVersion !== CONTRACT_CONFIRMATION_SCHEMA_VERSION ||
    typeof record?.contract?.contractHash !== "string"
  ) {
    return { status: "unconfirmed", confirmationPath };
  }
  if (record.contract.contractHash !== contractHash) {
    return { status: "changed", confirmationPath, record };
  }
  return { status: "confirmed", confirmationPath, record };
}

export async function recordContractConfirmation({ cwd, documentPath, contractPath, contractHash, now }) {
  const confirmationPath = getContractConfirmationPath(cwd, documentPath);
  const record = {
    schemaVersion: CONTRACT_CONFIRMATION_SCHEMA_VERSION,
    document: documentPath,
    contract: { path: contractPath, contractHash },
    confirmedAt: now ?? new Date().toISOString(),
  };
  await mkdir(path.dirname(confirmationPath), { recursive: true });
  const temporary = `${confirmationPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
  await rename(temporary, confirmationPath);
  return { confirmationPath, record };
}

// CLIのcontractとconfirmが共有する。文書がまだなくても契約だけで扱えるよう、
// 本文の存在は問わない（書く前に契約を作る流れのため）。
export async function describeDocumentContract({ cwd, file, yaml, Ajv, intentSchemaPath }) {
  const [documentPath] = resolveTargetPatterns({ cwd, files: [file] });
  if (!documentPath) throw new Error("Markdownファイルを1件指定してください");
  const contractPath = `${documentPath}.intent.yml`;
  const validate = await createContractValidator({ Ajv, intentSchemaPath });
  const contract = await loadDocumentContract({
    absolutePath: path.join(cwd, contractPath),
    relativePath: contractPath,
    yaml,
    validate,
  });
  if (contract.status === "missing") throw new Error(`文書契約がありません: ${contractPath}`);
  if (contract.status === "invalid") {
    throw new Error(
      `文書契約が無効です: ${contractPath}: ${contract.errors.map((error) => error.message).join("; ")}`,
    );
  }
  const confirmation = await inspectContractConfirmation({
    cwd,
    documentPath,
    contractHash: contract.contractHash,
  });
  return {
    documentPath,
    contractPath,
    contractHash: contract.contractHash,
    confirmation: confirmation.status,
    summary: formatContractSummary({
      contractPath,
      contract: contract.data,
      confirmation: confirmation.status,
    }),
  };
}
