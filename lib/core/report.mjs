export const REPORT_SCHEMA_VERSION = 1;

export function createHarnessReport({ documents, findings }) {
  const sortedDocuments = [...documents].sort((a, b) => a.path.localeCompare(b.path));
  const sortedFindings = [...findings].sort(
    (a, b) =>
      a.document.localeCompare(b.document) ||
      (a.location?.startLine ?? 0) - (b.location?.startLine ?? 0) ||
      (a.location?.startColumn ?? 0) - (b.location?.startColumn ?? 0) ||
      a.ruleId.localeCompare(b.ruleId),
  );

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    documents: sortedDocuments,
    findings: sortedFindings,
    summary: {
      documents: sortedDocuments.length,
      findings: sortedFindings.length,
      errors: sortedFindings.filter((finding) => finding.severity === "error").length,
      warnings: sortedFindings.filter((finding) => finding.severity === "warning").length,
      infos: sortedFindings.filter((finding) => finding.severity === "info").length,
    },
  };
}
