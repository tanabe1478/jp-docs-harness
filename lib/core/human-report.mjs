const SEVERITY_ORDER = ["error", "warning", "info"];
const SEVERITY_LABELS = {
  error: "エラー",
  warning: "警告",
  info: "情報",
};

export function hasBlockingFindings(report) {
  return report.findings.some((finding) => finding.severity === "error");
}

export function formatHarnessReport(report) {
  if (report.summary.documents === 0) {
    return "検査対象のMarkdownが見つかりませんでした。";
  }

  if (report.findings.length === 0) {
    return `Markdown ${report.summary.documents}件を検査しました。問題はありません。`;
  }

  const lines = [
    `Markdown ${report.summary.documents}件を検査しました: ${formatSummary(report.summary)}`,
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
  const counts = [
    ["error", summary.errors],
    ["warning", summary.warnings],
    ["info", summary.infos],
  ]
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${SEVERITY_LABELS[severity]} ${count}件`);
  return counts.join("、");
}

function formatFinding(finding) {
  const location = finding.location
    ? `:${finding.location.startLine}:${finding.location.startColumn}`
    : "";
  const owner =
    finding.resolution === "needs_author"
      ? " [書き手に確認]"
      : finding.resolution === "uncertain"
        ? " [要確認]"
        : finding.repairableByAgent
          ? " [AIで修正可能]"
          : "";
  return `  ${finding.document}${location} ${finding.message} (${finding.ruleId})${owner}`;
}

function formatActions(findings) {
  const repairable = findings.filter(
    (finding) => finding.resolution === "agent" && finding.repairableByAgent,
  ).length;
  const author = findings.filter((finding) => finding.resolution === "needs_author").length;
  const uncertain = findings.filter((finding) => finding.resolution === "uncertain").length;
  const lines = [];
  if (repairable > 0) lines.push(`  AIで修正できる指摘: ${repairable}件`);
  if (author > 0) lines.push(`  書き手の入力が必要な指摘: ${author}件`);
  if (uncertain > 0) lines.push(`  判断できないため確認が必要な指摘: ${uncertain}件`);
  return lines;
}
