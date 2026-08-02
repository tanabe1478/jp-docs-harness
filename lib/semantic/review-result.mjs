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
  if (result.evidenceHash !== packet.grounding.evidenceHash) {
    errors.push("evidenceHashがreview packetと一致しません");
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
  for (const evaluation of [
    ...result.evaluations,
    ...result.authorEvaluations,
    ...result.claimEvaluations,
  ]) {
    const location = evaluation.location;
    if (!location) continue;
    if (location.startLine > location.endLine) {
      errors.push(`${evaluation.checkId ?? evaluation.item ?? evaluation.claimId}: startLineがendLineを超えています`);
    }
    if (location.endLine > lineCount) {
      errors.push(`${evaluation.checkId ?? evaluation.item ?? evaluation.claimId}: locationが本文の行数を超えています`);
    }
  }

  if (result.groundingCoverage.status === "reviewed" && result.claimEvaluations.length === 0) {
    errors.push("groundingCoverageがreviewedですが主張評価がありません");
  }
  if (result.groundingCoverage.status === "no_verifiable_claims" && result.claimEvaluations.length > 0) {
    errors.push("検証可能な主張なしと主張評価を同時に記録できません");
  }
  validateClaims({ claims: result.claimEvaluations, packet, errors });
  validateEvaluationGrounding({ result, packet, errors });
  return errors;
}

function validateEvaluationGrounding({ result, packet, errors }) {
  const claimsById = new Map(result.claimEvaluations.map((claim) => [claim.claimId, claim]));
  const checksById = new Map(packet.rubric.checks.map((check) => [check.id, check]));

  for (const evaluation of result.evaluations) {
    const linkedClaims = [];
    for (const claimId of evaluation.claimIds) {
      const claim = claimsById.get(claimId);
      if (!claim) errors.push(`${evaluation.checkId}: 未知のclaimIdです: ${claimId}`);
      else linkedClaims.push(claim);
    }

    const check = checksById.get(evaluation.checkId);
    if (!check || check.sourcePolicy !== "required" || evaluation.verdict === "missing") continue;
    if (linkedClaims.length === 0) {
      errors.push(`${evaluation.checkId}: 根拠必須の判定にclaimIdsがありません`);
      continue;
    }
    const citedSources = new Set(
      linkedClaims.flatMap((claim) => claim.evidence.map((citation) => citation.sourceId)),
    );
    for (const sourceId of check.sourceIds) {
      if (!citedSources.has(sourceId)) {
        errors.push(`${evaluation.checkId}: 必須の根拠資料が主張から引用されていません: ${sourceId}`);
      }
    }
  }
}

function validateClaims({ claims, packet, errors }) {
  const ids = claims.map((claim) => claim.claimId);
  if (new Set(ids).size !== ids.length) errors.push("claimIdが重複しています");
  const sourceById = new Map(packet.grounding.sources.map((source) => [source.id, source]));

  for (const claim of claims) {
    if (
      claim.kind === "author-experience" &&
      claim.verdict !== "supported" &&
      claim.resolution !== "needs_author"
    ) {
      errors.push(`${claim.claimId}: 書き手固有の主張はneeds_authorにしてください`);
    }
    if (claim.kind === "author-experience" && claim.repairableByAgent) {
      errors.push(`${claim.claimId}: 書き手固有の主張はAIが修正できません`);
    }
    if (!claim.location) {
      errors.push(`${claim.claimId}: 主張のlocationがありません`);
    } else {
      const selected = selectLines(packet.document.content, claim.location);
      if (!selected.includes(claim.text)) {
        errors.push(`${claim.claimId}: textが指定された本文行に一致しません`);
      }
    }

    for (const citation of claim.evidence) {
      const source = sourceById.get(citation.sourceId);
      if (!source) {
        errors.push(`${claim.claimId}: 未知の根拠資料IDです: ${citation.sourceId}`);
        continue;
      }
      if (source.status !== "loaded") {
        errors.push(`${claim.claimId}: スナップショットのない根拠資料は引用できません: ${citation.sourceId}`);
        continue;
      }
      const sourceLineCount = source.content.split(/\r?\n/).length;
      if (citation.startLine > citation.endLine) {
        errors.push(`${claim.claimId}: 根拠のstartLineがendLineを超えています`);
      }
      if (citation.endLine > sourceLineCount) {
        errors.push(`${claim.claimId}: 根拠行が資料の行数を超えています: ${citation.sourceId}`);
      }
    }
  }
}

function selectLines(content, location) {
  return content
    .split(/\r?\n/)
    .slice(location.startLine - 1, location.endLine)
    .join("\n");
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
