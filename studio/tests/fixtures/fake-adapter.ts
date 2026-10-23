// 自動テスト専用の AiAdapter。通常起動（src/server/main.ts）からは読み込まない。
import { AiError, type AiAdapter, type AiInput, type AiOutput } from "../../src/server/providers/ai-adapter.ts";

export type FakeAdapter = AiAdapter & {
  calls: AiInput[];
  failNext(error: AiError): void;
  respondWith(output: (input: AiInput) => AiOutput): void;
};

export function defaultFakeOutput(input: AiInput): AiOutput {
  if (input.action === "propose") {
    return {
      kind: "proposal",
      replacementText: "しかし、問いを受け取るだけでは思考は深まらない。自分の考えと照らし合わせて初めて、対話に価値が生まれる。",
      rationale: "対話の価値が生まれる条件を、書き手の返答に沿って具体的にしました。",
    };
  }
  if (input.action === "reply") {
    return {
      kind: "reflection",
      interpretation: "対話そのものではなく、問いを自分の考えと照らし合わせる過程に価値がある、という読みに改めます。",
      reasoning: "あなたが「それは違う」と返したため、最初の読みを取り下げました。",
      question: "照らし合わせる過程を、文章の中でどこまで具体的に書きたいですか？",
    };
  }
  return {
    kind: "reflection",
    interpretation: "AIとの対話は必ずしも思考の深化につながらず、その質に違いがある、という主張だと読みました。",
    reasoning: "「いつも〜とは限らない」という表現から、対話の条件を探ろうとしているように感じます。",
    question: "あなたが価値を感じなかった対話には、どんな特徴がありましたか？",
    ...(input.action === "counterpoint" ? { uncertainty: "対話の種類によって結論が変わるかは、この箇所だけでは判断できません。" } : {}),
  };
}

export function createFakeAdapter(): FakeAdapter {
  const calls: AiInput[] = [];
  let pendingError: AiError | null = null;
  let responder: (input: AiInput) => AiOutput = defaultFakeOutput;
  return {
    provider: "fake",
    model: "fake-model",
    calls,
    failNext(error) {
      pendingError = error;
    },
    respondWith(output) {
      responder = output;
    },
    async respond(input) {
      calls.push(structuredClone(input));
      if (pendingError) {
        const error = pendingError;
        pendingError = null;
        throw error;
      }
      return responder(input);
    },
  };
}
