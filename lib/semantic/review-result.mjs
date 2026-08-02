import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function getReviewResultPath(cwd, documentPath) {
  return path.join(cwd, ".jp-docs-harness", "reviews", `${documentPath}.review.json`);
}

export async function loadJsonFile(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function createReviewResultValidator({ Ajv, reviewResultSchemaPath }) {
  const schema = await loadJsonFile(reviewResultSchemaPath);
  return new Ajv({ allErrors: true, strict: false }).compile(schema);
}

export function validateReviewResult({ result, packet, validate }) {
  const errors = [];
  if (!validate(result)) {
    errors.push(
      ...(validate.errors ?? []).map(
        (error) => `${error.instancePath || "/"} ${error.message ?? "結果がSchemaに適合しません"}`,
      ),
    );
    return errors;
  }

  if (result.document.path !== packet.document.path) errors.push("document.pathがreview packetと一致しません");
  if (result.document.contentHash !== packet.document.contentHash) errors.push("contentHashがreview packetと一致しません");
  if (result.contract.path !== packet.contract.path) errors.push("contract.pathがreview packetと一致しません");
  if (result.contract.contractHash !== packet.contract.contractHash) {
    errors.push("contractHashがreview packetと一致しません");
  }
  if (result.rubricHash !== packet.rubric.rubricHash) {
    errors.push("rubricHashがreview packetと一致しません");
  }

  compareExactIds({
    expected: packet.rubric.checks.map((check) => check.id),
    actual: result.evaluations.map((evaluation) => evaluation.checkId),
    label: "checkId",
    errors,
  });
  compareExactIds({
    expected: packet.rubric.authorOnly,
    actual: result.authorEvaluations.map((evaluation) => evaluation.item),
    label: "author_only item",
    errors,
  });

  const lineCount = packet.document.content.split(/\r?\n/).length;
  for (const evaluation of [...result.evaluations, ...result.authorEvaluations]) {
    const location = evaluation.location;
    if (!location) continue;
    if (location.startLine > location.endLine) {
      errors.push(`${evaluation.checkId ?? evaluation.item}: startLineがendLineを超えています`);
    }
    if (location.endLine > lineCount) {
      errors.push(`${evaluation.checkId ?? evaluation.item}: locationが本文の行数を超えています`);
    }
  }

  return errors;
}

export async function recordReviewResult({
  cwd,
  packet,
  result,
  Ajv,
  reviewPacketSchemaPath,
  reviewResultSchemaPath,
  outputPath,
}) {
  const packetSchema = await loadJsonFile(reviewPacketSchemaPath);
  const validatePacket = new Ajv({ allErrors: true, strict: false }).compile(packetSchema);
  if (!validatePacket(packet)) {
    const errors = (validatePacket.errors ?? [])
      .map((error) => `${error.instancePath || "/"} ${error.message ?? "packetがSchemaに適合しません"}`)
      .join("; ");
    throw new Error(`review packetが無効です: ${errors}`);
  }

  const validate = await createReviewResultValidator({ Ajv, reviewResultSchemaPath });
  const errors = validateReviewResult({ result, packet, validate });
  if (errors.length > 0) throw new Error(`レビュー結果が無効です: ${errors.join("; ")}`);

  const destination = outputPath
    ? path.resolve(cwd, outputPath)
    : getReviewResultPath(cwd, packet.document.path);
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`);
  await rename(temporary, destination);
  return destination;
}

export async function inspectStoredReview({ cwd, packet, Ajv, reviewResultSchemaPath }) {
  const reviewPath = getReviewResultPath(cwd, packet.document.path);
  if (!existsSync(reviewPath)) return { status: "missing", reviewPath, reasons: [] };

  try {
    const result = await loadJsonFile(reviewPath);
    const validate = await createReviewResultValidator({ Ajv, reviewResultSchemaPath });
    const errors = validateReviewResult({ result, packet, validate });
    if (errors.length > 0) {
      const stale = errors.some((error) => error.includes("Hash") || error.includes("contentHash"));
      return { status: stale ? "stale" : "invalid", reviewPath, reasons: errors, result };
    }
    return { status: "fresh", reviewPath, reasons: [], result };
  } catch (error) {
    return {
      status: "invalid",
      reviewPath,
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function compareExactIds({ expected, actual, label, errors }) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  if (actualSet.size !== actual.length) errors.push(`${label}が重複しています`);
  for (const id of expectedSet) {
    if (!actualSet.has(id)) errors.push(`${label}が不足しています: ${id}`);
  }
  for (const id of actualSet) {
    if (!expectedSet.has(id)) errors.push(`未知の${label}です: ${id}`);
  }
}
