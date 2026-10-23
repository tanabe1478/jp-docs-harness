import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { CheckResult, ContractResult } from "../../shared/schemas.ts";
import { StudioError } from "../errors.ts";
import { resolveExistingFile } from "../security/workspace.ts";
import type { DocumentService } from "./documents.ts";

const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DEFAULT_HARNESS_BIN = path.resolve(studioRoot, "..", "bin", "jp-docs-harness.mjs");

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_CONTRACT_BYTES = 256 * 1024;

// 既存CLIのJSON出力のうち、Studioが表示に使う部分だけを検証する。
const reportSchema = z.object({
  schemaVersion: z.literal(1),
  documents: z.array(z.object({ path: z.string() }).passthrough()),
  findings: z.array(
    z
      .object({
        id: z.string(),
        gate: z.string(),
        ruleId: z.string(),
        severity: z.enum(["error", "warning", "info"]),
        message: z.string(),
        location: z.object({ startLine: z.number().optional(), startColumn: z.number().optional() }).passthrough().optional(),
      })
      .passthrough(),
  ),
  summary: z.object({
    findings: z.number(),
    errors: z.number(),
    warnings: z.number(),
    infos: z.number(),
  }),
});

export type HarnessAvailability = { available: boolean; reason?: string };

export function inspectHarness(bin: string): HarnessAvailability {
  if (!existsSync(bin)) return { available: false, reason: `jp-docs-harness のCLIが見つかりません: ${bin}` };
  const packageRoot = path.resolve(path.dirname(bin), "..");
  if (!existsSync(path.join(packageRoot, "node_modules", "textlint"))) {
    return {
      available: false,
      reason: "jp-docs-harness の依存パッケージが未インストールです。リポジトリのルートで npm install を実行してください",
    };
  }
  return { available: true };
}

type RunResult = { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; overflow: boolean };

function runCli(bin: string, args: string[], cwd: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // shell を使わず、引数は配列で渡す。
    const child = spawn(process.execPath, [bin, ...args], {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let overflow = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        overflow,
      });
    });
  });
}

export function createHarnessService({
  root,
  documents,
  bin = DEFAULT_HARNESS_BIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => new Date().toISOString(),
}: {
  root: string;
  documents: DocumentService;
  bin?: string;
  timeoutMs?: number;
  now?: () => string;
}) {
  const availability = inspectHarness(bin);

  function requireAvailable() {
    if (!availability.available) {
      throw new StudioError("harness_unavailable", availability.reason ?? "検査を実行できません", 503);
    }
  }

  async function check(documentPath: string): Promise<CheckResult> {
    requireAvailable();
    const document = await documents.read(documentPath);
    let result: RunResult;
    try {
      result = await runCli(bin, ["check", "--format", "json", document.path], root, timeoutMs);
    } catch {
      throw new StudioError("harness_failed", "検査を起動できませんでした", 500);
    }
    if (result.timedOut) throw new StudioError("harness_timeout", "検査がタイムアウトしました", 504);
    if (result.overflow) throw new StudioError("harness_failed", "検査の出力が大きすぎます", 500);
    // 終了コード 0 と 1 は通常の結果。2 などはCLI自体の異常として扱う。
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new StudioError("harness_failed", "検査が異常終了しました", 500, {
        exitCode: result.exitCode,
        stderr: result.stderr.slice(0, 2000),
      });
    }
    let parsed;
    try {
      parsed = reportSchema.parse(JSON.parse(result.stdout));
    } catch {
      throw new StudioError("harness_failed", "検査結果を読み取れませんでした", 500);
    }
    return {
      path: document.path,
      documentHash: document.contentHash,
      ranAt: now(),
      exitCode: result.exitCode,
      documents: parsed.documents.length,
      findings: parsed.findings.map((finding) => ({
        id: finding.id,
        gate: finding.gate,
        ruleId: finding.ruleId,
        severity: finding.severity,
        message: finding.message,
        ...(finding.location
          ? {
              location: {
                ...(finding.location.startLine === undefined ? {} : { startLine: finding.location.startLine }),
                ...(finding.location.startColumn === undefined ? {} : { startColumn: finding.location.startColumn }),
              },
            }
          : {}),
      })),
      summary: parsed.summary,
    };
  }

  // 文書契約は読み取り専用で表示する。要約は既存CLIの contract コマンドに任せる。
  async function contract(documentPath: string): Promise<ContractResult> {
    const document = await documents.read(documentPath);
    const contractPath = `${document.path}.intent.yml`;
    let resolved;
    try {
      resolved = await resolveExistingFile(root, contractPath, {
        pattern: /\.intent\.ya?ml$/i,
        label: "文書契約",
        maxBytes: MAX_CONTRACT_BYTES,
      });
    } catch (error) {
      if (error instanceof StudioError && error.code === "not_found") return { status: "missing", contractPath };
      throw error;
    }
    const source = await fs.readFile(resolved.absolute, "utf8");
    if (!availability.available) {
      return { status: "present", contractPath, source, summaryError: availability.reason };
    }
    const result = await runCli(bin, ["contract", document.path], root, timeoutMs).catch(() => null);
    if (result && result.exitCode === 0) {
      return { status: "present", contractPath, source, summary: result.stdout.trim() };
    }
    const message = result?.stderr.replace(/^jp-docs-harness:\s*/, "").trim();
    return { status: "present", contractPath, source, summaryError: message || "契約の要約を作れませんでした" };
  }

  return { availability, check, contract };
}
