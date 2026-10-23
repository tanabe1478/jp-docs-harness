// 実際のモデルに1回ずつ解釈と修正案を依頼する。利用枠や課金を消費するため、明示的に実行したときだけ動く。
// 使い方: JP_DOCS_STUDIO_MODEL=... npm run test:ai-smoke
// （npm run login で ChatGPT にログイン済みならそれを、なければ OPENAI_API_KEY を使う）
import { FileCredentialStore, credentialFilePath } from "../../src/server/persistence/credential-store.ts";
import { defaultDataRoot } from "../../src/server/persistence/data-dir.ts";
import { resolveAiAdapter } from "../../src/server/providers/resolve.ts";

const { adapter, reason } = await resolveAiAdapter({
  credentials: new FileCredentialStore(credentialFilePath(defaultDataRoot())),
});
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
