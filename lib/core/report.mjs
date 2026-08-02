export const REPORT_SCHEMA_VERSION = 1;

export function createHarnessReport({ documents, findings }) {
  const sortedDocuments = [...documents].sort((a, b) => a.path.localeCompare(b.path));
  const sortedFindings = [...findings].sort(
    (a, b) =>
      a.document.localeCompare(b.document) ||
      a.location.startLine - b.location.startLine ||
      a.location.startColumn - b.location.startColumn ||
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
