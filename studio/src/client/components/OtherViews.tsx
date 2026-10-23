import { useState } from "react";
import type { CheckResult, ContractResult, DocumentSummary, HarnessFinding, ThreadView } from "../../shared/schemas.ts";
import { excerpt } from "./DiscussView.tsx";
import { Label, Panel } from "./Panel.tsx";

export type CheckState =
  | { kind: "running" }
  | { kind: "done"; result: CheckResult }
  | { kind: "error"; message: string };

const SEVERITY_LABELS: Record<HarnessFinding["severity"], string> = { error: "エラー", warning: "警告", info: "情報" };

export function CheckView({
  state,
  editedSinceCheck,
  onClose,
  onRerun,
  onJump,
}: {
  state: CheckState;
  editedSinceCheck: boolean;
  onClose(): void;
  onRerun(): void;
  onJump(finding: HarnessFinding): void;
}) {
  return (
    <Panel
      title="検査"
      onClose={onClose}
      testId="check-panel"
      footer={
        <>
          <div className="buttonrow">
            <button type="button" className="btn" disabled={state.kind === "running"} onClick={onRerun}>
              もう一度検査する
            </button>
          </div>
          <p className="sepcaption">jp-docs-harness の check を、保存済みの原稿に対して実行します</p>
        </>
      }
    >
      {state.kind === "running" ? (
        <p className="loading" role="status">
          検査しています…
        </p>
      ) : null}
      {state.kind === "error" ? (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "done" ? (
        <div data-testid="check-result">
          <p className="small">
            {new Date(state.result.ranAt).toLocaleTimeString("ja-JP")} に実行
            {editedSinceCheck ? "。検査後に原稿が変更されています" : ""}
          </p>
          {state.result.documents === 0 ? (
            <p className="notice">この原稿は検査対象になりませんでした（.textlintignore などで除外されている可能性があります）。</p>
          ) : state.result.findings.length === 0 ? (
            <p className="notice" data-testid="check-empty">
              指摘は0件でした。
            </p>
          ) : (
            <>
              <p className="small" data-testid="check-summary">
                指摘 {state.result.summary.findings}件（エラー {state.result.summary.errors} / 警告{" "}
                {state.result.summary.warnings} / 情報 {state.result.summary.infos}）
              </p>
              <ul className="findings">
                {state.result.findings.map((finding) => (
                  <li key={finding.id}>
                    <button
                      type="button"
                      className="finding"
                      disabled={!finding.location?.startLine}
                      onClick={() => onJump(finding)}
                    >
                      <span className={`severity severity-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
                      {finding.location?.startLine ? <span className="line">{finding.location.startLine}行目</span> : null}
                      <span className="message">{finding.message}</span>
                      <span className="rule">{finding.ruleId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

export type ContractState = { kind: "loading" } | { kind: "done"; result: ContractResult } | { kind: "error"; message: string };

export function ContractView({ state, onClose }: { state: ContractState; onClose(): void }) {
  return (
    <Panel title="文書契約" onClose={onClose} testId="contract-panel" footer={<p className="sepcaption">読み取り専用です。契約の作成と確定は plan-docs で行います</p>}>
      {state.kind === "loading" ? <p className="loading">読み込んでいます…</p> : null}
      {state.kind === "error" ? (
        <p className="notice notice-error" role="alert">
          {state.message}
        </p>
      ) : null}
      {state.kind === "done" && state.result.status === "missing" ? (
        <p className="notice" data-testid="contract-missing">
          文書契約は未設定です（{state.result.contractPath}）。
        </p>
      ) : null}
      {state.kind === "done" && state.result.status === "present" ? (
        <>
          <Label>{state.result.contractPath}</Label>
          {state.result.summary ? <pre className="contract-summary">{state.result.summary}</pre> : null}
          {state.result.summaryError ? <p className="notice notice-error">{state.result.summaryError}</p> : null}
          <details>
            <summary>契約ファイルの内容</summary>
            <pre className="contract-source">{state.result.source}</pre>
          </details>
        </>
      ) : null}
    </Panel>
  );
}

const THREAD_STATUS_LABELS: Record<string, string> = { open: "対話中", held: "保留", dismissed: "却下", stale: "位置が古い" };

export function ThreadListView({
  threads,
  onClose,
  onOpen,
}: {
  threads: ThreadView[];
  onClose(): void;
  onOpen(thread: ThreadView): void;
}) {
  return (
    <Panel title="この原稿の対話" onClose={onClose} testId="threads-panel">
      {threads.length === 0 ? <p className="small">まだ対話はありません。文章を選択して「どう読める？」を押すと始まります。</p> : null}
      <ul className="thread-list">
        {[...threads].reverse().map((thread) => (
          <li key={thread.id}>
            <button type="button" className="thread-item" onClick={() => onOpen(thread)}>
              <span className={`chip-status status-${thread.status}`}>{THREAD_STATUS_LABELS[thread.status]}</span>
              <span className="thread-quote">{excerpt(thread.anchor.quote, 60)}</span>
              <span className="small">
                発言 {thread.turns.length}件・気づき {thread.insights.length}件
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function DocumentList({
  documents,
  currentPath,
  onOpen,
  onCreate,
  dataLocation,
}: {
  documents: DocumentSummary[];
  currentPath: string | null;
  onOpen(path: string): void;
  onCreate(path: string): Promise<string | null>;
  dataLocation?: string;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="documents">
      <form
        className="create-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          const path = /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`;
          const failure = await onCreate(path);
          setError(failure);
          if (!failure) setName("");
        }}
      >
        <label className="tlabel" htmlFor="new-document">
          新しい原稿
        </label>
        <div className="create-row">
          <input
            id="new-document"
            className="text-input"
            placeholder="例: 考えるということ.md"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn primary" disabled={name.trim() === ""}>
            作成
          </button>
        </div>
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
      <Label>workspace の原稿</Label>
      {documents.length === 0 ? <p className="small">Markdown の原稿はまだありません。</p> : null}
      <ul className="doc-list">
        {documents.map((document) => (
          <li key={document.path}>
            <button
              type="button"
              className="doc-item"
              aria-current={document.path === currentPath ? "true" : undefined}
              onClick={() => onOpen(document.path)}
            >
              <span>{document.path}</span>
              <span className="small">{new Date(document.modifiedAt).toLocaleDateString("ja-JP")}</span>
            </button>
          </li>
        ))}
      </ul>
      {dataLocation ? (
        <p className="small data-location">
          対話・気づき・修正案の記録は workspace の外に保存しています: <code>{dataLocation}</code>
        </p>
      ) : null}
    </div>
  );
}

export function DocumentsView(props: Parameters<typeof DocumentList>[0] & { onClose(): void }) {
  return (
    <Panel title="原稿" onClose={props.onClose} testId="documents-panel">
      <DocumentList {...props} />
    </Panel>
  );
}

export function AiUnconfiguredView({ reason, onClose }: { reason: string; onClose(): void }) {
  return (
    <Panel title="この箇所について" onClose={onClose} testId="ai-unconfigured">
      <div className="notice" role="alert">
        <p>AIが設定されていないため、尋ねられません。</p>
        <p className="small">{reason}</p>
      </div>
      <p className="small">
        OPENAI_API_KEY と JP_DOCS_STUDIO_MODEL を環境変数に設定し、Studio のサーバーを起動し直してください。OpenAI API の利用は ChatGPT の有料プランとは別に課金されます。
      </p>
      <p className="small">執筆・保存・検査は、AIを設定しなくてもこのまま使えます。</p>
    </Panel>
  );
}
