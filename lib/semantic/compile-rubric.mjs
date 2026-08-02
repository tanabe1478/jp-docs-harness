const IMPORTANCE_ORDER = ["answer-critical", "valuable", "context"];

export function compileRubric(contract) {
  const metaRubrics = normalizeRequirements(contract.requirements);
  assertUniqueIds(metaRubrics);
  assertKnownSourceIds(metaRubrics, contract.evidence?.sources ?? []);
  const hasSources = (contract.evidence?.sources?.length ?? 0) > 0;
  const checks = metaRubrics.flatMap((metaRubric) => compileMetaRubric(metaRubric, hasSources));

  return {
    metaRubrics,
    checks,
    authorOnly: contract.evidence?.author_only ?? [],
  };
}

function normalizeRequirements(requirements) {
  if (Array.isArray(requirements)) return requirements;

  return [
    ...normalizeShorthandTier(requirements.critical ?? [], "answer-critical", "critical"),
    ...normalizeShorthandTier(requirements.valuable ?? [], "valuable", "valuable"),
    ...normalizeShorthandTier(requirements.context ?? [], "context", "context"),
  ];
}

function normalizeShorthandTier(items, importance, prefix) {
  return items.map((fact, index) => ({
    id: `${prefix}-${String(index + 1).padStart(3, "0")}`,
    importance,
    type: "simple-knowledge",
    description: fact,
    fact,
  }));
}

function compileMetaRubric(metaRubric, hasSources) {
  const checks = [];
  const add = (suffix, kind, importance, criterion) => {
    checks.push({
      id: `${metaRubric.id}-${suffix}`,
      metaRubricId: metaRubric.id,
      kind,
      importance,
      criterion,
      sourcePolicy: metaRubric.source_ids ? "required" : hasSources ? "available" : "contract",
      sourceIds: metaRubric.source_ids ?? [],
    });
  };

  if (metaRubric.type === "simple-knowledge") {
    add("fact", "knowledge", metaRubric.importance, `本文は「${metaRubric.fact}」を明示しているか？`);
  }

  if (metaRubric.type === "strict-list") {
    metaRubric.items.forEach((item, index) => {
      add(
        `item-${index + 1}`,
        "strict-list-item",
        metaRubric.importance,
        `本文は必須項目「${item}」を明示しているか？`,
      );
    });
  }

  if (metaRubric.type === "flexible-list") {
    if (metaRubric.baseline > metaRubric.items.length) {
      throw new Error(
        `${metaRubric.id}: baseline ${metaRubric.baseline}がitems数${metaRubric.items.length}を超えています`,
      );
    }
    const options = formatOptions(metaRubric.items);
    add(
      "baseline",
      "flexible-list-threshold",
      metaRubric.importance,
      `本文は次の選択肢から少なくとも${metaRubric.baseline}項目を含むか？ ${options}`,
    );

    const bonusImportance = lowerImportance(metaRubric.importance);
    if (metaRubric.items.length <= 7 && bonusImportance) {
      metaRubric.items.forEach((item, index) => {
        add(
          `item-${index + 1}`,
          "flexible-list-item",
          bonusImportance,
          `本文は追加項目「${item}」を含むか？`,
        );
      });
    }
  }

  if (metaRubric.type === "process") {
    const mandatorySteps = metaRubric.ordered_steps.filter((step) => step.mandatory);
    const optionalSteps = metaRubric.ordered_steps.filter((step) => !step.mandatory);
    const optionalImportance = lowerImportance(metaRubric.importance);

    metaRubric.ordered_steps.forEach((step, index) => {
      const importance = step.mandatory ? metaRubric.importance : optionalImportance;
      if (!importance) return;
      add(
        `step-${index + 1}`,
        step.mandatory ? "mandatory-process-step" : "optional-process-step",
        importance,
        `本文は${step.mandatory ? "必須" : "任意"}手順「${step.text}」を含むか？`,
      );
    });

    if (mandatorySteps.length >= 2) {
      add(
        "mandatory-order",
        "process-sequence",
        metaRubric.importance,
        `本文中に現れる必須手順は次の相対順序を守っているか？ ${formatSequence(mandatorySteps)}`,
      );
    }
    if (optionalSteps.length > 0 && optionalImportance) {
      add(
        "full-order",
        "process-sequence",
        optionalImportance,
        `本文中に現れる必須手順と任意手順は次の相対順序を守っているか？ ${formatSequence(metaRubric.ordered_steps)}`,
      );
    }
  }

  if (metaRubric.type === "relationship") {
    metaRubric.entities.forEach((entity, index) => {
      add(
        `entity-${index + 1}`,
        "relationship-entity",
        metaRubric.importance,
        `本文は関係する対象「${entity}」を明示しているか？`,
      );
    });
    metaRubric.aspects.forEach((aspect, index) => {
      add(
        `aspect-${index + 1}`,
        "relationship-aspect",
        metaRubric.importance,
        `本文は関係の側面「${aspect}」を明示しているか？`,
      );
    });
  }

  if (metaRubric.meta_insight) {
    add(
      "meta-insight",
      "meta-insight",
      metaRubric.importance,
      `本文は項目を横断する要点「${metaRubric.meta_insight}」を示しているか？`,
    );
  }

  return checks;
}

function lowerImportance(importance) {
  const index = IMPORTANCE_ORDER.indexOf(importance);
  return index >= 0 ? IMPORTANCE_ORDER[index + 1] : undefined;
}

function formatOptions(items) {
  return items.map((item, index) => `${index + 1}. ${item}`).join("、");
}

function formatSequence(steps) {
  return steps.map((step, index) => `${index + 1}. ${step.text}`).join(" → ");
}

function assertKnownSourceIds(metaRubrics, sources) {
  const sourceIds = sources.map((source) => source.id);
  const known = new Set(sourceIds);
  if (known.size !== sourceIds.length) throw new Error("根拠資料IDが重複しています");
  for (const metaRubric of metaRubrics) {
    for (const sourceId of metaRubric.source_ids ?? []) {
      if (!known.has(sourceId)) {
        throw new Error(`${metaRubric.id}: 未知の根拠資料IDです: ${sourceId}`);
      }
    }
  }
}

function assertUniqueIds(metaRubrics) {
  const ids = new Set();
  for (const item of metaRubrics) {
    if (ids.has(item.id)) throw new Error(`メタルーブリックIDが重複しています: ${item.id}`);
    ids.add(item.id);
  }
}
