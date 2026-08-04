const SEVERITY_ORDER = ["error", "warning", "info"];
const SEVERITY_LABELS = {
  error: "エラー",
  warning: "警告",
  info: "情報",
};
const OWNER_LABELS = {
  agent: "AIで修正可能",
  author: "書き手に確認",
  manual: "手作業で修正",
  uncertain: "要確認",
};
const OWNER_ACTIONS = [
  ["agent", "AIで修正できる指摘"],
  ["author", "書き手の入力が必要な指摘"],
  ["manual", "手作業での修正が必要な指摘"],
  ["uncertain", "判断できないため確認が必要な指摘"],
];

export function hasBlockingFindings(report, { failOn = "error" } = {}) {
  if (failOn === "warning") {
    return report.findings.some(
      (finding) => finding.severity === "error" || finding.severity === "warning",
    );
  }
  return report.findings.some((finding) => finding.severity === "error");
}

export function formatHarnessReport(report) {
  if (report.summary.documents === 0) {
    return "検査対象のMarkdownが見つかりませんでした。";
  }

  const reviewStatus = formatReviewStatus(report.documents);
  if (report.findings.length === 0) {
    return [
      `Markdown ${report.summary.documents}件を検査しました。問題はありません。`,
      reviewStatus,
    ].join("\n");
  }

  const lines = [
    `Markdown ${report.summary.documents}件を検査しました: ${formatSummary(report.summary)}`,
    reviewStatus,
  ];

  for (const severity of SEVERITY_ORDER) {
    const findings = report.findings.filter((finding) => finding.severity === severity);
    if (findings.length === 0) continue;
    lines.push("", `${SEVERITY_LABELS[severity]} ${findings.length}件`);
    for (const finding of findings) lines.push(formatFinding(finding));
  }

  const actions = formatActions(report.findings);
  if (actions.length > 0) lines.push("", "対応の目安", ...actions);

  return lines.join("\n");
}

function formatSummary(summary) {
  return [
    ["error", summary.errors],
    ["warning", summary.warnings],
    ["info", summary.infos],
  ]
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${SEVERITY_LABELS[severity]} ${count}件`)
    .join("、");
}

function formatReviewStatus(documents) {
  const counts = {
    fresh: 0,
    missing: 0,
    stale: 0,
    invalid: 0,
  };

  for (const document of documents) {
    const status = document.review?.status;
    if (status && status in counts) counts[status] += 1;
    else counts.missing += 1;
  }

  const parts = [
    ["最新", counts.fresh],
    ["未実行", counts.missing],
    ["要更新", counts.stale],
    ["無効", counts.invalid],
  ]
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${label} ${count}件`);
  const guidance = counts.missing > 0 ? "（重要文書にはreview-docsを使用）" : "";
  return `意味レビュー: ${parts.join("、")}${guidance}`;
}

function formatFinding(finding) {
  const location = finding.location
    ? `:${finding.location.startLine}:${finding.location.startColumn}`
    : "";
  const owner = OWNER_LABELS[findingOwner(finding)];
  return `  ${finding.document}${location} ${finding.message} (${finding.ruleId}) [${owner}]`;
}

// 誰が対応するかを一つに決める。AIが修正できない指摘を無印にすると、
// 対応不要と読み違えられるため、手作業として明示する。
function findingOwner(finding) {
  if (finding.resolution === "needs_author") return "author";
  if (finding.resolution === "uncertain") return "uncertain";
  if (finding.resolution === "agent" && finding.repairableByAgent) return "agent";
  return "manual";
}

function formatActions(findings) {
  const owners = findings.map(findingOwner);
  return OWNER_ACTIONS.flatMap(([owner, label]) => {
    const count = owners.filter((value) => value === owner).length;
    return count > 0 ? [`  ${label}: ${count}件`] : [];
  });
}
