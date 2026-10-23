import { z } from "zod";
import { MAX_REPLACEMENT_CHARS } from "../../shared/schemas.ts";

export type AiAction = "interpret" | "counterpoint" | "reply" | "propose";

export type AiInput = {
  action: AiAction;
  selection: string;
  surroundingContext: string;
  turns: Array<{ role: "author" | "ai"; text: string }>;
  authorReply?: string;
};

export type AiReflection = {
  kind: "reflection";
  interpretation: string;
  reasoning: string;
  question: string;
  uncertainty?: string;
};

export type AiProposal = { kind: "proposal"; replacementText: string; rationale: string };

export type AiOutput = AiReflection | AiProposal;

export interface AiAdapter {
  readonly provider: string;
  readonly model: string;
  respond(input: AiInput): Promise<AiOutput>;
}

export type AiErrorCode =
  | "auth"
  | "rate_limit"
  | "quota"
  | "model_not_found"
  | "timeout"
  | "connection"
  | "refused"
  | "invalid_response"
  | "provider";

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

const reflectionOutput = z.object({
  interpretation: z.string().trim().min(1).max(4000),
  reasoning: z.string().trim().min(1).max(4000),
  question: z.string().trim().min(1).max(2000),
  uncertainty: z.string().max(2000).optional().nullable(),
});

const proposalOutput = z.object({
  replacementText: z.string().min(1).max(MAX_REPLACEMENT_CHARS),
  rationale: z.string().max(2000),
});

// プロバイダーが返した値を、アプリが表示・保存してよい形に検証する。
export function validateAiOutput(action: AiAction, raw: unknown): AiOutput {
  if (action === "propose") {
    const result = proposalOutput.safeParse(raw);
    if (!result.success || result.data.replacementText.trim() === "") {
      throw new AiError("invalid_response", "AIの修正案が想定した形式ではありませんでした");
    }
    return { kind: "proposal", replacementText: result.data.replacementText, rationale: result.data.rationale.trim() };
  }
  const result = reflectionOutput.safeParse(raw);
  if (!result.success) {
    throw new AiError("invalid_response", "AIの応答が想定した形式ではありませんでした");
  }
  const uncertainty = result.data.uncertainty?.trim();
  return {
    kind: "reflection",
    interpretation: result.data.interpretation,
    reasoning: result.data.reasoning,
    question: result.data.question,
    ...(uncertainty ? { uncertainty } : {}),
  };
}
