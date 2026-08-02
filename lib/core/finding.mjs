import { createHash } from "node:crypto";

const SEVERITY = new Map([
  [0, "info"],
  [1, "warning"],
  [2, "error"],
]);

export function createSurfaceFinding({ document, message }) {
  const finding = {
    id: stableFindingId({ document, message }),
    gate: "surface",
    document,
    ruleId: message.ruleId,
    severity: SEVERITY.get(message.severity) ?? "error",
    verdict: "fail",
    resolution: "agent",
    message: message.message,
    location: {
      startLine: message.loc?.start.line ?? message.line,
      startColumn: message.loc?.start.column ?? message.column,
      endLine: message.loc?.end.line ?? message.line,
      endColumn: message.loc?.end.column ?? message.column,
    },
    repairableByAgent: true,
  };

  return finding;
}

function stableFindingId({ document, message }) {
  const source = [
    "surface",
    document,
    message.ruleId,
    message.loc?.start.line ?? message.line,
    message.loc?.start.column ?? message.column,
    message.message,
  ].join("\0");
  return `surface-${createHash("sha256").update(source).digest("hex").slice(0, 16)}`;
}
