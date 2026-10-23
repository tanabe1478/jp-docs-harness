// 実際の OpenAI API に1回ずつ解釈と修正案を依頼する。課金が発生するため、明示的に実行したときだけ動く。
// 使い方: OPENAI_API_KEY=... JP_DOCS_STUDIO_MODEL=... npm run test:ai-smoke
import { createAdapterFromEnv } from "../../src/server/providers/openai-adapter.ts";

const { adapter, reason } = createAdapterFromEnv();
if (!adapter) {
  process.stdout.write(`未実行: ${reason}\n`);
  process.exit(0);
}

const selection = "しかし、AIと対話することが、いつも思考を深めるとは限らない。";
const surroundingContext = `私は、AIとの対話を通じて自分の考えが明確になることに価値を感じている。\n\n［選択箇所］\n\nでは、どのような対話に価値があるのだろうか。`;

const reflection = await adapter.respond({ action: "interpret", selection, surroundingContext, turns: [] });
process.stdout.write(`interpret: ${JSON.stringify(reflection, null, 2)}\n`);
const proposal = await adapter.respond({ action: "propose", selection, surroundingContext, turns: [] });
process.stdout.write(`propose: ${JSON.stringify(proposal, null, 2)}\n`);
process.stdout.write(`OK: ${adapter.provider} / ${adapter.model}\n`);
