import type { ReactNode } from "react";
import type { SaveState } from "../app/useDocumentSession.ts";

export function LeafIcon() {
  return (
    <svg className="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M20.8 3C14 2 8 6 5.2 13.8L3 21l7.4-2C17.5 16.8 21.8 9.8 20.8 3Z" />
      <path d="M5 19c3-4 7.4-8.2 12-11" />
    </svg>
  );
}

export function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="m12 21 1.9-5.2L20 13l-6.1-2.8L12 5l-1.9 5.2L4 13l6.1 2.8L12 21Z" />
    </svg>
  );
}

// 背景の丘。CSS とインライン SVG だけで描き、外部の画像素材は使わない。
export function Landscape() {
  return (
    <svg className="landscape" preserveAspectRatio="none" viewBox="0 0 1440 260" aria-hidden="true">
      <defs>
        <linearGradient id="studio-hill">
          <stop stopColor="#9baea2" stopOpacity=".1" />
          <stop offset="1" stopColor="#819789" stopOpacity=".3" />
        </linearGradient>
      </defs>
      <path d="M0 165 C200 145 290 180 470 160 S780 126 960 163 S1300 132 1440 110 V260 H0Z" fill="url(#studio-hill)" />
      <path d="M0 209 C190 182 320 226 560 188 S960 211 1190 163 S1380 174 1440 150 V260 H0Z" fill="#b7c5b9" opacity=".22" />
    </svg>
  );
}

const SAVE_LABELS: Record<SaveState["kind"], string> = {
  saved: "保存済み",
  dirty: "未保存の変更",
  saving: "保存中…",
  error: "保存できませんでした",
  conflict: "競合しています",
};

export function SaveStatus({ state }: { state: SaveState }) {
  return (
    <div className={`status status-${state.kind}`} role="status" aria-live="polite" data-testid="save-status">
      <i className="tiny-dot" aria-hidden="true" />
      <span>{SAVE_LABELS[state.kind]}</span>
    </div>
  );
}

export function Header({
  documentPath,
  saveState,
  threadCount,
  referenceCount,
  onOpenReferences,
  onOpenAiSettings,
  onOpenDocuments,
  onOpenThreads,
  onOpenContract,
  onRunCheck,
}: {
  documentPath: string | null;
  saveState: SaveState | null;
  threadCount: number;
  referenceCount: number;
  onOpenReferences(): void;
  onOpenAiSettings(): void;
  onOpenDocuments(): void;
  onOpenThreads(): void;
  onOpenContract(): void;
  onRunCheck(): void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <LeafIcon />
        <span className="brand-name">jp-docs Studio</span>
        <button type="button" className="docname" onClick={onOpenDocuments} aria-label="原稿を選ぶ">
          {documentPath ?? "原稿を選ぶ"}
        </button>
      </div>
      <div className="hactions">
        {documentPath && saveState ? (
          <>
          <SaveStatus state={saveState} />
          <button type="button" className="tool" onClick={onOpenThreads}>
            対話{threadCount > 0 ? ` ${threadCount}` : ""}
          </button>
          <button type="button" className="tool" onClick={onOpenReferences}>
            資料{referenceCount > 0 ? ` ${referenceCount}` : ""}
          </button>
          <button type="button" className="tool" onClick={onOpenContract}>
            文書契約
          </button>
          <button type="button" className="tool" onClick={onRunCheck}>
            検査
          </button>
          </>
        ) : null}
        <button type="button" className="tool" onClick={onOpenAiSettings} aria-label="AIの設定">
          AI
        </button>
      </div>
    </header>
  );
}

export function Footer({
  soundOn,
  volume,
  onToggleSound,
  onVolume,
  characters,
  modeLabel,
  hint,
}: {
  soundOn: boolean;
  volume: number;
  onToggleSound(): void;
  onVolume(value: number): void;
  characters: number | null;
  modeLabel: string;
  hint: ReactNode;
}) {
  return (
    <footer className="foot">
      <div className="sound">
        <button
          type="button"
          className={`sound-pill${soundOn ? " on" : ""}`}
          aria-pressed={soundOn}
          onClick={onToggleSound}
          data-testid="sound-toggle"
        >
          <span aria-hidden="true">{soundOn ? "◉" : "◌"}</span> 環境音 <span className="sound-status">{soundOn ? "ON" : "OFF"}</span>
        </button>
        <label className="volume">
          <span>音量 {Math.round(volume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(volume * 100)}
            onChange={(event) => onVolume(Number(event.target.value) / 100)}
            aria-label="環境音の音量"
          />
        </label>
      </div>
      <div className="footright">
        <span className="hint">{hint}</span>
        {characters === null ? null : <span data-testid="char-count">{characters} 字</span>}
        <i aria-hidden="true">│</i>
        <span>{modeLabel}</span>
      </div>
    </footer>
  );
}
