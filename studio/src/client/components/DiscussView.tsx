import { useEffect, useRef, useState } from "react";
import type { AiConfig, SentScope, ThreadView, Turn } from "../../shared/schemas.ts";
import { Label, Panel } from "./Panel.tsx";

export type AiCallState =
  | { kind: "loading"; purpose: "assist" | "propose" }
  | { kind: "error"; purpose: "assist" | "propose"; code: string; message: string };

const STATUS_NOTES: Record<string, string> = {
  held: "この対話は保留中です。再開すると続けられます。",
  dismissed: "この対話は却下しました。再開すると続けられます。",
  stale:
    "原稿が変更されたため、この対話は古い位置に基づいています。AIへの質問と修正案は使えません。続けるときは、改めて選択してください。",
};

export function DiscussView({
  thread,
  ai,
  aiConfig,
  sent,
  onClose,
  onReply,
  onRetry,
  onDecision,
  onInsight,
  onOpenProposal,
}: {
  thread: ThreadView;
  ai: AiCallState | null;
  aiConfig: AiConfig;
  sent: SentScope | null;
  onClose(): void;
  onReply(text: string): Promise<boolean>;
  onRetry(): void;
  onDecision(decision: "held" | "dismissed" | "reopened"): void;
  onInsight(text: string): Promise<boolean>;
  onOpenProposal(): void;
}) {
  const [reply, setReply] = useState("");
  const [insight, setInsight] = useState("");
  const [insightOpen, setInsightOpen] = useState(false);
  const latestTurn = useRef<HTMLDivElement>(null);
  // 新しい発言が届いたら、その先頭が見える位置までパネル内をスクロールする。
  // scrollIntoView は祖先の要素まで動かし本文の位置を変えうるため、パネル内だけを動かす。
  useEffect(() => {
    const turn = latestTurn.current;
    const body = turn?.closest<HTMLElement>(".panelbody");
    if (!turn || !body) return;
    body.scrollTop = turn.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
  }, [thread.turns.length]);
  const loading = ai?.kind === "loading";
  const open = thread.status === "open";
  const hasAiTurn = thread.turns.some((turn) => turn.role === "ai");
  const awaitingAi = !hasAiTurn || thread.turns.at(-1)?.role === "author";

  const footer = (
    <>
      <div className="buttonrow">
        <button
          type="button"
          className="btn primary"
          disabled={!open || loading || reply.trim() === "" || !hasAiTurn}
          onClick={async () => {
            if (await onReply(reply)) setReply("");
          }}
        >
          返答する
        </button>
        {thread.status === "open" ? (
          <>
            <button type="button" className="btn alt" disabled={loading} onClick={() => onDecision("held")}>
              保留
            </button>
            <button type="button" className="btn alt" disabled={loading} onClick={() => onDecision("dismissed")}>
              却下
            </button>
          </>
        ) : thread.decision !== "open" ? (
          <button type="button" className="btn alt" onClick={() => onDecision("reopened")}>
            再開
          </button>
        ) : null}
        <button type="button" className="btn" disabled={!open || loading || !aiConfig.configured} onClick={onOpenProposal}>
          修正案を見る →
        </button>
      </div>
      <p className="sepcaption" data-testid="send-scope">
        {aiConfig.configured ? (
          <>
            AI送信範囲: 選択文・前後の限定文脈・この対話
            <br />
            送信先: {providerLabel(aiConfig.provider)} {aiConfig.model}
            {sent ? `（前回 選択${sent.selectionChars}字・文脈${sent.contextChars}字・発言${sent.turns}件）` : ""}
          </>
        ) : (
          "AIは未設定です。執筆と保存はこのまま使えます。"
        )}
      </p>
    </>
  );

  return (
    <Panel title="この箇所について" onClose={onClose} footer={footer} testId="discuss-panel">
      <blockquote
        className="anchor-quote"
        aria-label={`対象の箇所（${thread.mode === "interpret" ? "どう読めるか" : "別の見方"}を尋ねた対話）`}
        title={thread.mode === "interpret" ? "どう読めるかを尋ねた対話" : "別の見方を尋ねた対話"}
      >
        {excerpt(thread.anchor.quote, 48)}
      </blockquote>
      {STATUS_NOTES[thread.status] ? (
        <p className={`notice notice-${thread.status}`} role="note" data-testid="thread-status">
          {STATUS_NOTES[thread.status]}
        </p>
      ) : null}

      <div className="turns" aria-live="polite">
        {thread.turns.map((turn, index) => (
          <div key={turn.id} ref={index === thread.turns.length - 1 ? latestTurn : undefined}>
            <TurnView turn={turn} />
          </div>
        ))}
      </div>

      {loading ? (
        <p className="loading" role="status">
          {ai.purpose === "propose" ? "修正案を作っています…" : "AIが読んでいます…"}
        </p>
      ) : null}
      {ai?.kind === "error" ? (
        <div className="notice notice-error" role="alert" data-testid="ai-error">
          <p>{ai.message}</p>
          {ai.purpose === "assist" && open && awaitingAi ? (
            <button type="button" className="btn" onClick={onRetry}>
              もう一度尋ねる
            </button>
          ) : null}
        </div>
      ) : null}
      {!loading && ai === null && open && awaitingAi && aiConfig.configured ? (
        <div className="notice">
          <p>{hasAiTurn ? "返答はまだAIに届いていません。" : "まだAIに尋ねていません。"}</p>
          <button type="button" className="btn" onClick={onRetry}>
            AIに尋ねる
          </button>
        </div>
      ) : null}

      {hasAiTurn ? (
        <div className="reply-block">
          <label className="tlabel" htmlFor="reply">
            あなたの返答
          </label>
          <div className="chips">
            {["それは違う。", "今は保留したい。"].map((chip) => (
              <button
                key={chip}
                type="button"
                className="chip"
                disabled={!open}
                onClick={() => setReply((current) => (current ? `${current}${chip}` : chip))}
              >
                {chip.replace("。", "")}
              </button>
            ))}
          </div>
          <textarea
            id="reply"
            className="reply"
            placeholder="AIの解釈に同意しなくても構いません"
            value={reply}
            disabled={!open}
            onChange={(event) => setReply(event.target.value)}
          />
        </div>
      ) : null}

      <section className="insights" aria-label="書き手自身の気づき">
        <Label>書き手自身の気づき</Label>
        {thread.insights.length === 0 ? <p className="small">まだ記録していません。</p> : null}
        {thread.insights.map((item) => (
          <div key={item.id} className="insight" data-testid="insight">
            {item.text}
          </div>
        ))}
        {insightOpen ? (
          <form
            className="insight-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onInsight(insight)) {
                setInsight("");
                setInsightOpen(false);
              }
            }}
          >
            <textarea
              className="reply"
              aria-label="気づきを自分の言葉で書く"
              placeholder="自分の言葉で残します。AIの文はここに自動では入りません"
              value={insight}
              onChange={(event) => setInsight(event.target.value)}
            />
            <div className="buttonrow">
              <button type="submit" className="btn primary" disabled={insight.trim() === ""}>
                気づきを保存
              </button>
              <button type="button" className="btn alt" onClick={() => setInsightOpen(false)}>
                やめる
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="btn" onClick={() => setInsightOpen(true)}>
            気づきを記録
          </button>
        )}
      </section>
    </Panel>
  );
}

function TurnView({ turn }: { turn: Turn }) {
  if (turn.role === "author") {
    return (
      <div className="turn-author" data-testid="author-turn">
        <Label>あなたの返答</Label>
        <p>{turn.text}</p>
      </div>
    );
  }
  const reflection = turn.reflection;
  if (!reflection) return <p className="pgroup">{turn.text}</p>;
  return (
    <div className="turn-ai" data-testid="ai-turn">
      <div className="pgroup">
        <Label>こう読めました</Label>
        <p>{reflection.interpretation}</p>
      </div>
      <div className="pgroup">
        <Label>そう考えた理由</Label>
        <p>{reflection.reasoning}</p>
      </div>
      <div>
        <Label>確認したいこと</Label>
        <div className="question">{reflection.question}</div>
      </div>
      {reflection.uncertainty ? (
        <div className="pgroup">
          <Label>判断できないこと</Label>
          <p className="small">{reflection.uncertainty}</p>
        </div>
      ) : null}
    </div>
  );
}

function providerLabel(provider: string): string {
  return provider === "openai" ? "OpenAI" : provider;
}

export function excerpt(text: string, limit = 80): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
