import type { ProposalView as Proposal, ThreadView } from "../../shared/schemas.ts";
import { Label, Panel } from "./Panel.tsx";

export function ProposalView({
  proposal,
  thread,
  busy,
  error,
  onClose,
  onAccept,
  onReject,
  onBack,
}: {
  proposal: Proposal;
  thread: ThreadView;
  busy: boolean;
  error: string | null;
  onClose(): void;
  onAccept(): void;
  onReject(): void;
  onBack(): void;
}) {
  const pending = proposal.status === "pending";
  const latestInsight = thread.insights.at(-1);

  const footer = (
    <>
      <div className="buttonrow">
        {pending ? (
          <>
            <button type="button" className="btn primary" disabled={busy} onClick={onAccept}>
              この修正を採用
            </button>
            <button type="button" className="btn alt" disabled={busy} onClick={onReject}>
              破棄
            </button>
          </>
        ) : null}
        <button type="button" className="btn" onClick={onBack}>
          対話に戻る
        </button>
      </div>
      <p className="sepcaption">
        {proposal.status === "accepted" ? "採用した変更は原稿に保存されています" : "承認するまで原稿は変更されません"}
      </p>
    </>
  );

  return (
    <Panel title="修正案を検討する" onClose={onClose} footer={footer} testId="proposal-panel">
      <Label>置換する箇所</Label>
      <p className="small">
        {proposal.status === "accepted"
          ? "この修正を採用しました。変更前と変更後を残しています。"
          : proposal.status === "rejected"
            ? "この修正案は破棄しました。原稿は変わっていません。"
            : "原稿はまだ変更されていません。差分を確認してから判断してください。"}
      </p>
      <div className="diffbox" data-testid="diff">
        <div className="diffrow" aria-label="削除される文">
          <span className="diffsign" aria-hidden="true">
            −
          </span>
          <div className="difftext">
            <span className="visually-hidden">削除: </span>
            <del className="removed">{proposal.anchor.quote}</del>
          </div>
        </div>
        <div className="diffrow" aria-label="追加される文">
          <span className="diffsign" aria-hidden="true">
            ＋
          </span>
          <div className="difftext">
            <span className="visually-hidden">追加: </span>
            <ins className="added">{proposal.replacementText}</ins>
          </div>
        </div>
      </div>
      {proposal.replacementText === proposal.anchor.quote ? (
        <p className="small">AIの修正案は原文と同じでした。</p>
      ) : null}
      {proposal.rationale ? (
        <div className="pgroup">
          <Label>AIが挙げた理由</Label>
          <p className="small">{proposal.rationale}</p>
        </div>
      ) : null}
      {latestInsight ? (
        <div>
          <Label>書き手自身の気づき</Label>
          <div className="insight">{latestInsight.text}</div>
        </div>
      ) : null}
      {proposal.status === "stale" ? (
        <p className="notice notice-error" role="alert" data-testid="proposal-stale">
          元の文章が変更されています。選択し直してください。
        </p>
      ) : pending ? (
        <p className="warning">選択範囲だけを置換します。採用しない限りMarkdownは変わりません。</p>
      ) : null}
      {/* 古くなった提案は上の注意で伝えるため、同じ内容のエラーを重ねない。 */}
      {error && proposal.status !== "stale" ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
