import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { EditorHandle } from "../editor/Editor.tsx";
import { detectLineSeparator, normalizeLineSeparators } from "../editor/offsets.ts";
import { ApiError, api } from "./api.ts";

const AUTOSAVE_DELAY_MS = 900;

export type SaveState =
  | { kind: "saved" }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "error"; message: string }
  | { kind: "conflict"; message: string };

export type OpenDocument = {
  path: string;
  modifiedAt: string;
  loadId: number;
  initialContent: string;
  lineSeparator: "\n" | "\r\n";
  normalizedLineSeparators: boolean;
};

export function useDocumentSession(editor: RefObject<EditorHandle | null>) {
  const [document, setDocument] = useState<OpenDocument | null>(null);
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved" });
  const [savedHash, setSavedHash] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const pathRef = useRef<string | null>(null);
  const savedHashRef = useRef<string | null>(null);
  const savedContentRef = useRef<string>("");
  const conflictRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const loadCounter = useRef(0);

  const markSaved = useCallback((hash: string, savedContent: string) => {
    savedHashRef.current = hash;
    savedContentRef.current = savedContent;
    setSavedHash(hash);
  }, []);

  const open = useCallback(
    async (path: string) => {
      setOpenError(null);
      try {
        const payload = await api.readDocument(path);
        const info = detectLineSeparator(payload.content);
        const initialContent = info.mixed
          ? normalizeLineSeparators(payload.content, info.separator)
          : payload.content;
        pathRef.current = payload.path;
        conflictRef.current = false;
        markSaved(payload.contentHash, payload.content);
        loadCounter.current += 1;
        setDocument({
          path: payload.path,
          modifiedAt: payload.modifiedAt,
          loadId: loadCounter.current,
          initialContent,
          lineSeparator: info.separator,
          normalizedLineSeparators: info.mixed,
        });
        setContent(initialContent);
        setSaveState(initialContent === payload.content ? { kind: "saved" } : { kind: "dirty" });
        try {
          localStorage.setItem("jp-docs-studio.lastDocument", payload.path);
        } catch {
          // 保存できなくても動作には影響しない。
        }
        return true;
      } catch (error) {
        setOpenError(error instanceof ApiError ? error.message : "原稿を開けませんでした");
        return false;
      }
    },
    [markSaved],
  );

  // 保存済みの内容とエディタの内容が一致したら true を返す。
  const save = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (conflictRef.current) return false;
    if (inFlight.current) {
      await inFlight.current;
      if (conflictRef.current) return false;
    }
    const path = pathRef.current;
    const handle = editor.current;
    const expectedHash = savedHashRef.current;
    if (!path || !handle || !expectedHash) return false;
    const current = handle.content();
    if (current === savedContentRef.current) {
      setSaveState({ kind: "saved" });
      return true;
    }
    setSaveState({ kind: "saving" });
    const run = (async () => {
      try {
        const result = await api.saveDocument(path, current, expectedHash);
        if (pathRef.current !== path) return false;
        markSaved(result.contentHash, current);
        setDocument((previous) => (previous ? { ...previous, modifiedAt: result.modifiedAt } : previous));
        const latest = editor.current?.content() ?? current;
        setSaveState(latest === current ? { kind: "saved" } : { kind: "dirty" });
        return latest === current;
      } catch (error) {
        if (error instanceof ApiError && error.code === "conflict") {
          conflictRef.current = true;
          setSaveState({
            kind: "conflict",
            message: "このファイルは別の場所で変更されました。未保存の内容はエディタに残っています。",
          });
        } else {
          setSaveState({
            kind: "error",
            message: error instanceof ApiError ? error.message : "保存できませんでした",
          });
        }
        return false;
      }
    })();
    inFlight.current = run;
    try {
      return await run;
    } finally {
      if (inFlight.current === run) inFlight.current = null;
    }
  }, [editor, markSaved]);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      // IME 変換中は保存しない。変換が確定したら改めて予約する。
      if (editor.current?.isComposing()) return;
      void save();
    }, AUTOSAVE_DELAY_MS);
  }, [editor, save]);

  const onChange = useCallback(
    (next: string) => {
      setContent(next);
      if (conflictRef.current) return;
      if (next === savedContentRef.current) {
        setSaveState({ kind: "saved" });
        return;
      }
      setSaveState((previous) => (previous.kind === "saving" ? previous : { kind: "dirty" }));
      schedule();
    },
    [schedule],
  );

  const onCompositionEnd = useCallback(() => {
    if (!conflictRef.current && editor.current?.content() !== savedContentRef.current) schedule();
  }, [editor, schedule]);

  // AIへの依頼や検査の前に、未保存の変更を保存する。
  const flush = useCallback(async () => save(), [save]);

  // 採用した修正案などで、サーバー側で書き換わった内容を保存済みとして取り込む。
  const acceptServerContent = useCallback(
    (hash: string, serverContent: string, modifiedAt: string) => {
      markSaved(hash, serverContent);
      setDocument((previous) => (previous ? { ...previous, modifiedAt } : previous));
      setContent(editor.current?.content() ?? serverContent);
      setSaveState({ kind: "saved" });
    },
    [editor, markSaved],
  );

  const overwriteWithMine = useCallback(async () => {
    const path = pathRef.current;
    if (!path) return;
    try {
      const disk = await api.readDocument(path);
      conflictRef.current = false;
      savedHashRef.current = disk.contentHash;
      savedContentRef.current = disk.content;
      await save();
    } catch (error) {
      setSaveState({ kind: "error", message: error instanceof ApiError ? error.message : "保存できませんでした" });
    }
  }, [save]);

  const reloadFromDisk = useCallback(async () => {
    const path = pathRef.current;
    if (path) await open(path);
  }, [open]);

  const close = useCallback(() => {
    pathRef.current = null;
    setDocument(null);
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (pathRef.current && editor.current && editor.current.content() !== savedContentRef.current) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editor]);

  return {
    document,
    content,
    saveState,
    savedHash,
    savedContent: () => savedContentRef.current,
    currentSavedHash: () => savedHashRef.current,
    openError,
    open,
    close,
    save,
    flush,
    onChange,
    onCompositionEnd,
    acceptServerContent,
    overwriteWithMine,
    reloadFromDisk,
  };
}
