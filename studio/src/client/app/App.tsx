import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AiConfig,
  DocumentSummary,
  HarnessFinding,
  ReferenceView,
  SentScope,
  StudioConfig,
  ThreadMode,
  ThreadView,
} from "../../shared/schemas.ts";
import { AmbientSound } from "../audio/ambient.ts";
import { Footer, Header, Landscape } from "../components/Chrome.tsx";
import { DiscussView, type AiCallState } from "../components/DiscussView.tsx";
import {
  AiUnconfiguredView,
  CheckView,
  ContractView,
  DocumentList,
  DocumentsView,
  ThreadListView,
  type CheckState,
  type ContractState,
} from "../components/OtherViews.tsx";
import { ProposalView } from "../components/ProposalView.tsx";
import { SelectionBar } from "../components/SelectionBar.tsx";
import { AiSettingsView, ReferencesView } from "../components/StudioPanels.tsx";
import { Editor, type EditorHandle, type SelectionSnapshot } from "../editor/Editor.tsx";
import { countCharacters } from "../editor/offsets.ts";
import { ApiError, api } from "./api.ts";
import { native, openExternal } from "./native.ts";
import { useDocumentSession } from "./useDocumentSession.ts";

type PanelState =
  | null
  | { view: "thread"; threadId: string }
  | { view: "proposal"; threadId: string; proposalId: string }
  | { view: "threads" }
  | { view: "check" }
  | { view: "contract" }
  | { view: "documents" }
  | { view: "references" }
  | { view: "ai-settings" }
  | { view: "ai-unconfigured" };

const VOLUME_KEY = "jp-docs-studio.volume";
const LAST_DOCUMENT_KEY = "jp-docs-studio.lastDocument";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できなくても動作には影響しない。
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function App() {
  const editor = useRef<EditorHandle | null>(null);
  const session = useDocumentSession(editor);
  const [config, setConfig] = useState<StudioConfig | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [threads, setThreads] = useState<ThreadView[]>([]);
  const [panel, setPanel] = useState<PanelState>(null);
  const [ai, setAi] = useState<{ threadId: string; state: AiCallState } | null>(null);
  const [sent, setSent] = useState<SentScope | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalError, setProposalError] = useState<string | null>(null);
  const [check, setCheck] = useState<CheckState | null>(null);
  const [contract, setContract] = useState<ContractState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [references, setReferences] = useState<ReferenceView[]>([]);
  const [referenceCandidates, setReferenceCandidates] = useState<DocumentSummary[]>([]);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const [aiModels, setAiModels] = useState<string[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [editorFocused, setEditorFocused] = useState(false);
  const [barFocused, setBarFocused] = useState(false);
  const [pointerDown, setPointerDown] = useState(false);
  const [barPosition, setBarPosition] = useState<{ left: number; top: number } | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [volume, setVolume] = useState(() => {
    const stored = Number(readStorage(VOLUME_KEY));
    return Number.isFinite(stored) && stored > 0 && stored <= 1 ? stored : 0.4;
  });
  const sound = useRef<AmbientSound | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  const writingArea = useRef<HTMLDivElement>(null);

  const documentPath = session.document?.path ?? null;

  // ---- 起動 ----
  useEffect(() => {
    void (async () => {
      try {
        if (native) void native.ready().catch(() => setNotice("デスクトップ版の機能に接続できませんでした"));
        const [loadedConfig, list] = await Promise.all([api.config(), api.listDocuments()]);
        setConfig(loadedConfig);
        setDocuments(list.documents);
        const last = readStorage(LAST_DOCUMENT_KEY);
        if (last && list.documents.some((document) => document.path === last)) await session.open(last);
      } catch (error) {
        setFatal(messageOf(error, "Studio のサーバーに接続できません"));
      }
    })();
    // 起動時に一度だけ実行する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshThreads = useCallback(async (path: string) => {
    try {
      const result = await api.listThreads(path);
      setThreads(result.threads);
    } catch (error) {
      setNotice(messageOf(error, "対話を読み込めませんでした"));
    }
  }, []);

  const refreshReferences = useCallback(async (path: string) => {
    try {
      setReferences((await api.listReferences(path)).references);
    } catch (error) {
      setReferenceError(messageOf(error, "参考資料を読み込めませんでした"));
    }
  }, []);

  useEffect(() => {
    if (documentPath) void refreshReferences(documentPath);
  }, [documentPath, refreshReferences]);

  // 保存のたびに stale の判定が変わるため、対話の状態を読み直す。
  useEffect(() => {
    if (documentPath && session.savedHash) void refreshThreads(documentPath);
  }, [documentPath, session.savedHash, refreshThreads]);

  const upsertThread = useCallback((thread: ThreadView) => {
    setThreads((previous) => {
      const index = previous.findIndex((candidate) => candidate.id === thread.id);
      if (index < 0) return [...previous, thread];
      const next = [...previous];
      next[index] = thread;
      return next;
    });
  }, []);

  const activeThread = useMemo(() => {
    if (panel?.view !== "thread" && panel?.view !== "proposal") return null;
    return threads.find((thread) => thread.id === panel.threadId) ?? null;
  }, [panel, threads]);

  // 対話中の箇所を本文上で示す。位置が古い対話は示さない。
  useEffect(() => {
    const handle = editor.current;
    if (!handle) return;
    if (activeThread && activeThread.status !== "stale") {
      handle.highlightOffsets(activeThread.anchor.start, activeThread.anchor.end, panel?.view === "proposal" ? "proposal" : "thread");
    } else if (panel?.view !== "ai-unconfigured") {
      handle.highlight(null);
    }
  }, [activeThread, panel?.view]);

  const closePanel = useCallback(() => {
    setPanel(null);
    setProposalError(null);
    editor.current?.highlight(null);
    // 閉じたら原稿へ戻る。カーソルと選択はエディタが保持している。
    editor.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && panel) {
        event.preventDefault();
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel]);

  // ---- 選択バーの位置 ----
  const showBar = Boolean(selection) && (editorFocused || barFocused) && !pointerDown;
  const updateBarPosition = useCallback(() => {
    const view = editor.current?.view();
    const current = editor.current?.selection();
    if (!view || !current) {
      setBarPosition(null);
      return;
    }
    const start = view.coordsAtPos(current.from);
    if (!start) {
      setBarPosition(null);
      return;
    }
    const width = 248;
    const left = Math.max(12, Math.min(start.left - 12, window.innerWidth - width - 12));
    const above = start.top - 52;
    const top = above > 96 ? above : (view.coordsAtPos(current.to)?.bottom ?? start.bottom) + 10;
    setBarPosition({ left, top });
  }, []);

  useLayoutEffect(() => {
    if (showBar) updateBarPosition();
  }, [showBar, selection, updateBarPosition]);

  useEffect(() => {
    const area = writingArea.current;
    if (!area) return;
    const onScroll = () => {
      if (showBar) updateBarPosition();
    };
    area.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      area.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [showBar, updateBarPosition]);

  useEffect(() => {
    const up = () => setPointerDown(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, []);

  // ---- AIとの対話 ----
  const runAssist = useCallback(
    async (threadId: string) => {
      setAi({ threadId, state: { kind: "loading", purpose: "assist" } });
      try {
        const result = await api.assist(threadId);
        upsertThread(result.thread);
        setSent(result.sent);
        setAi(null);
      } catch (error) {
        setAi({
          threadId,
          state: {
            kind: "error",
            purpose: "assist",
            code: error instanceof ApiError ? error.code : "unknown",
            message: messageOf(error, "AIに尋ねられませんでした"),
          },
        });
        if (documentPath) void refreshThreads(documentPath);
      }
    },
    [documentPath, refreshThreads, upsertThread],
  );

  // 保存済みの内容とエディタが一致していることを確かめる。AIや検査はこの状態でだけ動かす。
  const ensureSaved = useCallback(async (): Promise<boolean> => {
    const ok = await session.flush();
    if (!ok || editor.current?.content() !== session.savedContent()) {
      setNotice("原稿を保存できていないため、実行できません。保存の状態を確認してください");
      return false;
    }
    return true;
  }, [session]);

  const ask = useCallback(
    async (mode: ThreadMode) => {
      const handle = editor.current;
      const current = handle?.selection();
      if (!handle || !current || !documentPath || !config) return;
      setBarFocused(false);
      if (!config.ai.configured) {
        handle.highlightOffsets(current.start, current.end, "thread");
        setPanel({ view: "ai-unconfigured" });
        return;
      }
      if (!(await ensureSaved())) return;
      const hash = session.currentSavedHash();
      const snapshot = handle.selection() ?? current;
      if (!hash) return;
      try {
        const thread = await api.createThread(
          documentPath,
          { quote: snapshot.quote, start: snapshot.start, end: snapshot.end, sourceDocumentHash: hash },
          mode,
        );
        upsertThread(thread);
        setSent(null);
        setPanel({ view: "thread", threadId: thread.id });
        await runAssist(thread.id);
      } catch (error) {
        setNotice(messageOf(error, "対話を始められませんでした"));
      }
    },
    [config, documentPath, ensureSaved, runAssist, session, upsertThread],
  );

  const reply = useCallback(
    async (threadId: string, text: string) => {
      try {
        upsertThread(await api.addTurn(threadId, text));
      } catch (error) {
        setAi({ threadId, state: { kind: "error", purpose: "assist", code: "turn", message: messageOf(error, "返答を保存できませんでした") } });
        return false;
      }
      void runAssist(threadId);
      return true;
    },
    [runAssist, upsertThread],
  );

  const decideThread = useCallback(
    async (threadId: string, decision: "held" | "dismissed" | "reopened") => {
      try {
        upsertThread(await api.decide(threadId, decision));
      } catch (error) {
        setNotice(messageOf(error, "判断を保存できませんでした"));
      }
    },
    [upsertThread],
  );

  const addInsight = useCallback(
    async (threadId: string, text: string) => {
      try {
        upsertThread(await api.addInsight(threadId, text));
        return true;
      } catch (error) {
        setNotice(messageOf(error, "気づきを保存できませんでした"));
        return false;
      }
    },
    [upsertThread],
  );

  const openProposal = useCallback(
    async (thread: ThreadView) => {
      setProposalError(null);
      const existing = [...thread.proposals].reverse().find((proposal) => proposal.status === "pending");
      if (existing) {
        setPanel({ view: "proposal", threadId: thread.id, proposalId: existing.id });
        return;
      }
      if (!(await ensureSaved())) return;
      setAi({ threadId: thread.id, state: { kind: "loading", purpose: "propose" } });
      try {
        const result = await api.propose(thread.id);
        upsertThread(result.thread);
        setSent(result.sent);
        setAi(null);
        setPanel({ view: "proposal", threadId: thread.id, proposalId: result.proposal.id });
      } catch (error) {
        setAi({
          threadId: thread.id,
          state: {
            kind: "error",
            purpose: "propose",
            code: error instanceof ApiError ? error.code : "unknown",
            message: messageOf(error, "修正案を作れませんでした"),
          },
        });
        if (documentPath) void refreshThreads(documentPath);
      }
    },
    [documentPath, ensureSaved, refreshThreads, upsertThread],
  );

  const decideProposal = useCallback(
    async (proposalId: string, decision: "accepted" | "rejected") => {
      setProposalError(null);
      setProposalBusy(true);
      try {
        if (decision === "accepted" && !(await ensureSaved())) return;
        const hash = session.currentSavedHash();
        if (!hash) return;
        const result = await api.decideProposal(proposalId, decision, hash);
        if (result.document) {
          const handle = editor.current;
          // 置き換えた範囲だけをエディタに反映し、カーソルとスクロールを保つ。
          handle?.replaceOffsets(result.proposal.anchor.start, result.proposal.anchor.end, result.proposal.replacementText);
          if (handle && handle.content() !== result.document.content) handle.setContent(result.document.content);
          session.acceptServerContent(result.document.contentHash, result.document.content, result.document.modifiedAt);
        }
        upsertThread(result.thread);
      } catch (error) {
        setProposalError(messageOf(error, "修正案を反映できませんでした"));
        if (documentPath) void refreshThreads(documentPath);
      } finally {
        setProposalBusy(false);
      }
    },
    [documentPath, ensureSaved, refreshThreads, session, upsertThread],
  );

  // ---- 検査と契約 ----
  const runCheck = useCallback(async () => {
    if (!documentPath) return;
    setPanel({ view: "check" });
    setCheck({ kind: "running" });
    if (!(await ensureSaved())) {
      setCheck({ kind: "error", message: "原稿を保存できていないため、検査できません" });
      return;
    }
    try {
      setCheck({ kind: "done", result: await api.check(documentPath) });
    } catch (error) {
      setCheck({ kind: "error", message: messageOf(error, "検査を実行できませんでした") });
    }
  }, [documentPath, ensureSaved]);

  const openContract = useCallback(async () => {
    if (!documentPath) return;
    setPanel({ view: "contract" });
    setContract({ kind: "loading" });
    try {
      setContract({ kind: "done", result: await api.contract(documentPath) });
    } catch (error) {
      setContract({ kind: "error", message: messageOf(error, "文書契約を読み込めませんでした") });
    }
  }, [documentPath]);

  const jumpToFinding = useCallback((finding: HarnessFinding) => {
    if (!finding.location?.startLine) return;
    editor.current?.goToLine(finding.location.startLine, finding.location.startColumn);
  }, []);

  // ---- 原稿の切り替え ----
  const refreshDocuments = useCallback(async () => {
    try {
      setDocuments((await api.listDocuments()).documents);
    } catch (error) {
      setNotice(messageOf(error, "原稿の一覧を読み込めませんでした"));
    }
  }, []);

  const switchDocument = useCallback(
    async (path: string) => {
      if (session.document) {
        const saved = await session.flush();
        if (!saved && !window.confirm("未保存の変更があります。破棄して別の原稿を開きますか？")) return;
      }
      setThreads([]);
      setReferences([]);
      setCheck(null);
      setContract(null);
      setAi(null);
      setSelection(null);
      if (await session.open(path)) setPanel(null);
    },
    [session],
  );

  // ---- 参考資料 ----
  const openReferences = useCallback(async () => {
    if (!documentPath) return;
    setPanel({ view: "references" });
    setReferenceError(null);
    await refreshReferences(documentPath);
    try {
      setReferenceCandidates((await api.listFiles()).files);
    } catch (error) {
      setReferenceError(messageOf(error, "ファイルの一覧を読み込めませんでした"));
    }
  }, [documentPath, refreshReferences]);

  const referenceAction = useCallback(
    async (action: () => Promise<unknown>, fallback: string) => {
      if (!documentPath) return;
      setReferenceError(null);
      try {
        await action();
      } catch (error) {
        setReferenceError(messageOf(error, fallback));
      }
      await refreshReferences(documentPath);
    },
    [documentPath, refreshReferences],
  );

  // ---- AIの設定 ----
  const applyAi = useCallback((status: AiConfig) => {
    setConfig((previous) => (previous ? { ...previous, ai: status } : previous));
  }, []);

  const openAiSettings = useCallback(async () => {
    setPanel({ view: "ai-settings" });
    setAiError(null);
    try {
      const [status, models] = await Promise.all([api.aiStatus(), api.aiModels()]);
      applyAi(status);
      setAiModels(models.models);
    } catch (error) {
      setAiError(messageOf(error, "AIの設定を読み込めませんでした"));
    }
  }, [applyAi]);

  const aiAction = useCallback(
    async (action: () => Promise<AiConfig | void>, fallback: string) => {
      setAiBusy(true);
      setAiError(null);
      try {
        const status = await action();
        applyAi(status ?? (await api.aiStatus()));
      } catch (error) {
        setAiError(messageOf(error, fallback));
      } finally {
        setAiBusy(false);
      }
    },
    [applyAi],
  );

  const login = useCallback(
    () =>
      aiAction(async () => {
        const { authUrl } = await api.startLogin();
        await openExternal(authUrl);
      }, "ログインを始められませんでした"),
    [aiAction],
  );

  // ブラウザでのログインが終わるまで、状態を数秒おきに確かめる。
  const loginPending = config?.ai.login.state === "pending";
  useEffect(() => {
    if (!loginPending) return;
    const timer = setInterval(() => {
      void api.aiStatus().then(applyAi, () => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [loginPending, applyAi]);

  const createDocument = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const created = await api.createDocument(path);
        await refreshDocuments();
        await switchDocument(created.path);
        return null;
      } catch (error) {
        return messageOf(error, "原稿を作成できませんでした");
      }
    },
    [refreshDocuments, switchDocument],
  );

  // ---- 環境音 ----
  const toggleSound = useCallback(async () => {
    sound.current ??= new AmbientSound();
    if (sound.current.playing) {
      sound.current.stop();
      setSoundOn(false);
      return;
    }
    try {
      await sound.current.start(volume);
      setSoundOn(true);
    } catch {
      setNotice("このブラウザでは環境音を再生できませんでした");
    }
  }, [volume]);

  const changeVolume = useCallback((value: number) => {
    setVolume(value);
    writeStorage(VOLUME_KEY, String(value));
    sound.current?.setVolume(value);
  }, []);

  useEffect(() => {
    const stop = () => {
      sound.current?.stop();
      setSoundOn(false);
    };
    window.addEventListener("pagehide", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      sound.current?.dispose();
    };
  }, []);

  // ---- 表示 ----
  if (fatal) {
    return (
      <div className="scene">
        <main className="fatal" role="alert">
          <h1>Studio を開けませんでした</h1>
          <p>{fatal}</p>
        </main>
      </div>
    );
  }

  const modeLabel =
    panel?.view === "thread"
      ? "AIとの対話"
      : panel?.view === "proposal"
        ? "あなたが判断する"
        : panel?.view === "check"
          ? "検査"
          : "静かな執筆";

  const hint = !session.document
    ? ""
    : selection
      ? "⌘/Ctrl+Enter で選択箇所をAIに尋ねる"
      : "文章を選択すると、AIに読み方を尋ねられます";

  const activeProposal =
    panel?.view === "proposal" && activeThread
      ? activeThread.proposals.find((proposal) => proposal.id === panel.proposalId) ?? null
      : null;

  return (
    <div className="scene" data-panel={panel ? panel.view : "none"}>
      <Landscape />
      <Header
        documentPath={documentPath}
        saveState={session.document ? session.saveState : null}
        threadCount={threads.length}
        referenceCount={references.filter((reference) => reference.include).length}
        onOpenReferences={() => void openReferences()}
        onOpenAiSettings={() => void openAiSettings()}
        onOpenDocuments={() => {
          setPanel({ view: "documents" });
          void refreshDocuments();
        }}
        onOpenThreads={() => setPanel({ view: "threads" })}
        onOpenContract={() => void openContract()}
        onRunCheck={() => void runCheck()}
      />

      {session.saveState.kind === "conflict" && session.document ? (
        <div className="banner banner-conflict" role="alert" data-testid="conflict-banner">
          <p>{session.saveState.message}</p>
          <div className="buttonrow">
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (window.confirm("別の場所での変更を上書きして、エディタの内容で保存しますか？")) void session.overwriteWithMine();
              }}
            >
              自分の版で上書き保存
            </button>
            <button
              type="button"
              className="btn alt"
              onClick={() => {
                if (window.confirm("エディタの未保存の内容を破棄して、ファイルの内容を読み込みますか？")) void session.reloadFromDisk();
              }}
            >
              ファイルの版を読み込む
            </button>
          </div>
        </div>
      ) : null}
      {session.saveState.kind === "error" ? (
        <div className="banner banner-error" role="alert">
          <p>{session.saveState.message}</p>
          <button type="button" className="btn" onClick={() => void session.save()}>
            もう一度保存
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="banner" role="status">
          <p>{notice}</p>
          <button type="button" className="btn alt" onClick={() => setNotice(null)}>
            閉じる
          </button>
        </div>
      ) : null}

      <div className="writing-area" ref={writingArea}>
        <main className="column">
          {session.document ? (
            <>
              <p className="eyebrow">
                {eyebrowLabel(session.document.path, config?.workspaceName)}　/　{formatDate(session.document.modifiedAt)}
              </p>
              {session.document.normalizedLineSeparators ? (
                <p className="notice">改行コードが混在していたため、保存時に統一されます。</p>
              ) : null}
              <div
                className="editor-wrap"
                onPointerDown={() => setPointerDown(true)}
              >
                <Editor
                  key={session.document.loadId}
                  ref={editor}
                  initialContent={session.document.initialContent}
                  lineSeparator={session.document.lineSeparator}
                  onChange={session.onChange}
                  onSelectionChange={(next, focused) => {
                    setSelection(next);
                    setEditorFocused(focused);
                  }}
                  onCompositionEnd={session.onCompositionEnd}
                  onSaveShortcut={() => void session.save()}
                  onAskShortcut={() => {
                    bar.current?.querySelector("button")?.focus();
                  }}
                />
              </div>
            </>
          ) : (
            <section className="empty" aria-labelledby="empty-title">
              <p className="eyebrow">{config?.workspaceName ?? ""}</p>
              <h1 id="empty-title">書きはじめる</h1>
              <p className="empty-lead">原稿を開くか、新しく作ってください。原稿は workspace 内の Markdown ファイルとして保存されます。</p>
              {session.openError ? (
                <p className="notice notice-error" role="alert">
                  {session.openError}
                </p>
              ) : null}
              {config ? (
                <DocumentList
                  documents={documents}
                  currentPath={null}
                  onOpen={(path) => void switchDocument(path)}
                  onCreate={createDocument}
                  dataLocation={config.dataLocation}
                  {...(native ? { onChooseWorkspace: () => void native?.chooseWorkspace() } : {})}
                />
              ) : (
                <p className="loading">読み込んでいます…</p>
              )}
            </section>
          )}
        </main>
      </div>

      {showBar && barPosition ? (
        <SelectionBar
          ref={bar}
          position={barPosition}
          onAsk={(mode) => void ask(mode)}
          onFocusChange={setBarFocused}
          onEscape={() => {
            setBarFocused(false);
            editor.current?.focus();
          }}
        />
      ) : null}

      {panel?.view === "thread" && activeThread && config ? (
        <DiscussView
          key={activeThread.id}
          thread={activeThread}
          ai={ai?.threadId === activeThread.id ? ai.state : null}
          aiConfig={config.ai}
          sent={sent}
          attachedReferences={references.filter((reference) => reference.include && reference.available).length}
          onClose={closePanel}
          onReply={(text) => reply(activeThread.id, text)}
          onRetry={() => void runAssist(activeThread.id)}
          onDecision={(decision) => void decideThread(activeThread.id, decision)}
          onInsight={(text) => addInsight(activeThread.id, text)}
          onOpenProposal={() => void openProposal(activeThread)}
        />
      ) : null}
      {panel?.view === "proposal" && activeThread && activeProposal ? (
        <ProposalView
          proposal={activeProposal}
          thread={activeThread}
          busy={proposalBusy}
          error={proposalError}
          onClose={closePanel}
          onAccept={() => void decideProposal(activeProposal.id, "accepted")}
          onReject={() => void decideProposal(activeProposal.id, "rejected")}
          onBack={() => {
            setProposalError(null);
            setPanel({ view: "thread", threadId: activeThread.id });
          }}
        />
      ) : null}
      {panel?.view === "threads" ? (
        <ThreadListView
          threads={threads}
          onClose={closePanel}
          onOpen={(thread) => {
            setAi(null);
            setSent(null);
            setPanel({ view: "thread", threadId: thread.id });
          }}
        />
      ) : null}
      {panel?.view === "check" && check ? (
        <CheckView
          state={check}
          editedSinceCheck={check.kind === "done" && check.result.documentHash !== session.savedHash}
          onClose={closePanel}
          onRerun={() => void runCheck()}
          onJump={jumpToFinding}
        />
      ) : null}
      {panel?.view === "contract" && contract ? <ContractView state={contract} onClose={closePanel} /> : null}
      {panel?.view === "documents" ? (
        <DocumentsView
          documents={documents}
          currentPath={documentPath}
          onOpen={(path) => void switchDocument(path)}
          onCreate={createDocument}
          {...(config ? { dataLocation: config.dataLocation } : {})}
          {...(native ? { onChooseWorkspace: () => void native?.chooseWorkspace() } : {})}
          onClose={closePanel}
        />
      ) : null}
      {panel?.view === "ai-unconfigured" && config && !config.ai.configured ? (
        <AiUnconfiguredView
          reason={config.ai.reason}
          onClose={closePanel}
          {...(config.ai.manageable ? { onOpenSettings: () => void openAiSettings() } : {})}
        />
      ) : null}
      {panel?.view === "references" && documentPath ? (
        <ReferencesView
          documentPath={documentPath}
          references={references}
          candidates={referenceCandidates}
          nativePicker={Boolean(native)}
          error={referenceError}
          onClose={closePanel}
          onAdd={(file) => void referenceAction(() => api.addReference(documentPath, file), "資料を加えられませんでした")}
          onToggle={(reference, include) => {
            // 押した時点で表示を変え、保存の結果で読み直す。
            setReferences((previous) => previous.map((item) => (item.id === reference.id ? { ...item, include } : item)));
            void referenceAction(() => api.updateReference(reference.id, include), "資料の設定を変えられませんでした");
          }}
          onRemove={(reference) => void referenceAction(() => api.removeReference(reference.id), "資料を外せませんでした")}
          onPickExternal={() => {
            const bridge = native;
            if (bridge) void referenceAction(() => bridge.pickReferences(documentPath), "ファイルを加えられませんでした");
          }}
        />
      ) : null}
      {panel?.view === "ai-settings" && config ? (
        <AiSettingsView
          ai={config.ai}
          models={aiModels}
          busy={aiBusy}
          error={aiError}
          onClose={closePanel}
          onLogin={() => void login()}
          onLogout={() => void aiAction(() => api.logout(), "ログアウトできませんでした")}
          onSaveModel={(model) => void aiAction(() => api.updateAiSettings({ model }), "モデルを保存できませんでした")}
          onChooseMode={(mode) => void aiAction(() => api.updateAiSettings({ mode }), "方式を変えられませんでした")}
        />
      ) : null}

      <Footer
        soundOn={soundOn}
        volume={volume}
        onToggleSound={() => void toggleSound()}
        onVolume={changeVolume}
        characters={session.document ? countCharacters(session.content) : null}
        modeLabel={modeLabel}
        hint={hint}
      />
    </div>
  );
}

function eyebrowLabel(path: string, workspaceName: string | undefined): string {
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  return directory || workspaceName || "workspace";
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}
