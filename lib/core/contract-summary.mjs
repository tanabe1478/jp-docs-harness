const CONFIRMATION_LABELS = {
  confirmed: "確認済み",
  unconfirmed: "未確認",
  changed: "確認後に変更",
};

const IMPORTANCE_LABELS = [
  ["answer-critical", "欠かせない内容"],
  ["valuable", "あると価値が上がる内容"],
  ["context", "背景"],
];

// 書き手が契約を確定する前に読む要約。YAMLを開かなくても、
// 読者、読後の変化、要件、書き手にしか書けない情報を一画面で確かめられるようにする。
export function formatContractSummary({ contractPath, contract, confirmation }) {
  const lines = [`文書契約: ${contractPath}（${CONFIRMATION_LABELS[confirmation] ?? confirmation}）`];
  lines.push(`種類: ${contract.profile}${contract.preset ? `（プリセット ${contract.preset}）` : ""}`);

  const problems = [contract.audience.problem].flat();
  pushList(lines, "読者が困っていること", problems);
  pushList(lines, "読者がすでに知っていること", contract.audience.knows ?? []);
  pushList(lines, "読後に分かること", contract.reader_delta.know);
  pushList(lines, "読後に決められること", contract.reader_delta.decide);
  pushList(lines, "読後にできること", contract.reader_delta.do);

  const requirements = normalizeRequirements(contract.requirements);
  for (const [importance, label] of IMPORTANCE_LABELS) {
    pushList(
      lines,
      label,
      requirements.filter((item) => item.importance === importance).map((item) => item.text),
    );
  }

  pushList(lines, "書き手にしか書けないこと", contract.evidence?.author_only ?? []);
  pushList(lines, "書かないこと", contract.non_goals ?? []);
  pushList(
    lines,
    "根拠資料",
    (contract.evidence?.sources ?? []).map((source) => source.path ?? source.url),
  );
  return lines.join("\n");
}

function normalizeRequirements(requirements) {
  if (!Array.isArray(requirements)) {
    return [
      ...(requirements.critical ?? []).map((text) => ({ importance: "answer-critical", text })),
      ...(requirements.valuable ?? []).map((text) => ({ importance: "valuable", text })),
      ...(requirements.context ?? []).map((text) => ({ importance: "context", text })),
    ];
  }
  return requirements.map((item) => ({ importance: item.importance, text: item.description }));
}

function pushList(lines, label, items) {
  if (items.length === 0) return;
  lines.push(`${label}:`);
  for (const item of items) lines.push(`  - ${item}`);
}
