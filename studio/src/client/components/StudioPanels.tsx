import { useEffect, useState } from "react";
import type { AiConfig, DocumentSummary, ReferenceView } from "../../shared/schemas.ts";
import { Label, Panel } from "./Panel.tsx";

export function ReferencesView({
  documentPath,
  references,
  candidates,
  nativePicker,
  error,
  onClose,
  onAdd,
  onToggle,
  onRemove,
  onPickExternal,
}: {
  documentPath: string;
  references: ReferenceView[];
  candidates: DocumentSummary[];
  nativePicker: boolean;
  error: string | null;
  onClose(): void;
  onAdd(file: string): void;
  onToggle(reference: ReferenceView, include: boolean): void;
  onRemove(reference: ReferenceView): void;
  onPickExternal(): void;
}) {
  const [file, setFile] = useState("");
  const available = candidates.filter(
    (candidate) => candidate.path !== documentPath && !references.some((reference) => reference.kind === "workspace" && reference.path === candidate.path),
  );
  const included = references.filter((reference) => reference.include && reference.available);
  const includedChars = included.reduce((sum, reference) => sum + (reference.chars ?? 0), 0);

  return (
    <Panel
      title="参考資料"
      onClose={onClose}
      testId="references-panel"
      footer={
        <p className="sepcaption">
          AIに尋ねるとき、「添える」にした資料の本文も送ります（1件8000字、合計24000字まで）。いまは {included.length}件・{includedChars}字。
        </p>
      }
    >
      <p className="small">この原稿について考えるときに、AIにも読んでほしい資料を選びます。原稿と同じく、資料の中の指示にAIが従うことはありません。</p>
      {references.length === 0 ? <p className="small">まだ資料はありません。</p> : null}
      <ul className="reference-list">
        {references.map((reference) => (
          <li key={reference.id} className="reference-item" data-testid="reference">
            <label className="reference-toggle">
              <input
                type="checkbox"
                checked={reference.include}
                disabled={!reference.available}
                onChange={(event) => onToggle(reference, event.target.checked)}
              />
              <span>AIに添える</span>
            </label>
            <div className="reference-body">
              <span className="reference-name">{reference.name}</span>
              <span className="small">
                {reference.kind === "external" ? "workspace の外・" : ""}
                {reference.available ? `${reference.chars ?? 0}字` : reference.problem}
              </span>
            </div>
            <button type="button" className="btn alt" onClick={() => onRemove(reference)} aria-label={`${reference.name} を資料から外す`}>
              外す
            </button>
          </li>
        ))}
      </ul>

      <form
        className="create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (file) onAdd(file);
          setFile("");
        }}
      >
        <label className="tlabel" htmlFor="reference-file">
          workspace のファイルを加える
        </label>
        <div className="create-row">
          <select id="reference-file" className="text-input" value={file} onChange={(event) => setFile(event.target.value)}>
            <option value="">Markdown かテキストを選ぶ</option>
            {available.map((candidate) => (
              <option key={candidate.path} value={candidate.path}>
                {candidate.path}
              </option>
            ))}
          </select>
          <button type="submit" className="btn primary" disabled={!file}>
            加える
          </button>
        </div>
      </form>
      {nativePicker ? (
        <div className="insights">
          <Label>workspace の外のファイル</Label>
          <button type="button" className="btn" onClick={onPickExternal}>
            ファイルを選ぶ…
          </button>
        </div>
      ) : (
        <p className="small">workspace の外のファイルは、デスクトップ版でファイルを選んで加えられます。</p>
      )}
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}

export function AiSettingsView({
  ai,
  models,
  busy,
  error,
  onClose,
  onLogin,
  onLogout,
  onSaveModel,
  onChooseMode,
}: {
  ai: AiConfig;
  models: string[];
  busy: boolean;
  error: string | null;
  onClose(): void;
  onLogin(): void;
  onLogout(): void;
  onSaveModel(model: string | null): void;
  onChooseMode(mode: "chatgpt" | "openai-api" | null): void;
}) {
  const [model, setModel] = useState(ai.settings.model ?? ai.model ?? "");
  useEffect(() => setModel(ai.settings.model ?? ai.model ?? ""), [ai.settings.model, ai.model]);

  return (
    <Panel title="AIの設定" onClose={onClose} testId="ai-settings-panel">
      <div className="notice" role="status" data-testid="ai-state">
        {ai.configured ? (
          <p>
            使用中: {ai.provider === "openai-chatgpt" ? "ChatGPT のサブスクリプション" : "OpenAI API"}・{ai.model}
          </p>
        ) : (
          <p>{ai.reason}</p>
        )}
      </div>

      {!ai.manageable ? <p className="small">この起動方法では、AIの設定を画面から変えられません。</p> : null}

      {ai.manageable ? (
        <>
          <section className="insights" aria-label="ChatGPT へのログイン">
            <Label>ChatGPT のサブスクリプション</Label>
            {ai.loggedIn ? (
              <>
                <p className="small">ログイン済みです。</p>
                <button type="button" className="btn alt" disabled={busy} onClick={onLogout}>
                  ログアウト
                </button>
              </>
            ) : ai.login.state === "pending" ? (
              <p className="small" data-testid="login-pending">
                ブラウザでログインを続けてください。終わると自動でこの画面に反映されます。
              </p>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={onLogin}>
                ChatGPT でログイン
              </button>
            )}
            {ai.login.state === "failed" ? (
              <p className="notice notice-error" role="alert">
                {ai.login.error}
              </p>
            ) : null}
          </section>

          <form
            className="create-form"
            onSubmit={(event) => {
              event.preventDefault();
              onSaveModel(model.trim() || null);
            }}
          >
            <label className="tlabel" htmlFor="ai-model">
              モデル
            </label>
            <div className="create-row">
              <input
                id="ai-model"
                className="text-input"
                list="ai-model-options"
                value={model}
                placeholder="例: gpt-6-sol"
                onChange={(event) => setModel(event.target.value)}
              />
              <datalist id="ai-model-options">
                {models.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <button type="submit" className="btn primary" disabled={busy}>
                保存
              </button>
            </div>
            {ai.overriddenByEnv.model ? <p className="small">環境変数 JP_DOCS_STUDIO_MODEL が設定されているため、そちらを使っています。</p> : null}
            <p className="small">ChatGPT のプランで使えるモデルは OpenAI 側で決まります。一覧にあっても使えないことがあります。</p>
          </form>

          {ai.apiKeyAvailable ? (
            <section className="insights" aria-label="使う方式">
              <Label>使う方式</Label>
              <div className="buttonrow">
                {(
                  [
                    [null, "自動"],
                    ["chatgpt", "ChatGPT"],
                    ["openai-api", "OpenAI API"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={label}
                    type="button"
                    className={`btn${ai.settings.mode === mode ? " primary" : " alt"}`}
                    aria-pressed={ai.settings.mode === mode}
                    disabled={busy}
                    onClick={() => onChooseMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="small">自動では、ChatGPT にログイン済みならそれを、そうでなければ OPENAI_API_KEY を使います。OpenAI API の利用は ChatGPT のプランとは別に課金されます。</p>
            </section>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
    </Panel>
  );
}
