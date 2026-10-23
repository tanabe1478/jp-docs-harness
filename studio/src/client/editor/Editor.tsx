import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { highlightField, setHighlight, type Highlight } from "./highlight.ts";
import { editorContent, offsetToPos, posToOffset } from "./offsets.ts";

const markdownStyle = HighlightStyle.define([
  { tag: tags.heading1, fontSize: "1.62em", fontWeight: "500", letterSpacing: "0.07em", lineHeight: "1.55" },
  { tag: tags.heading2, fontSize: "1.3em", fontWeight: "500", letterSpacing: "0.05em" },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontSize: "1.1em", fontWeight: "600" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.link, color: "var(--accent)" },
  { tag: tags.url, color: "var(--muted)" },
  { tag: tags.monospace, fontFamily: "var(--monofont)", fontSize: "0.88em" },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: "var(--muted)" },
  { tag: tags.quote, color: "var(--sub)" },
]);

export type SelectionSnapshot = {
  from: number;
  to: number;
  quote: string;
  start: number;
  end: number;
};

export type EditorHandle = {
  view(): EditorView | null;
  content(): string;
  selection(): SelectionSnapshot | null;
  replaceOffsets(start: number, end: number, text: string): void;
  setContent(content: string): void;
  focus(): void;
  highlight(value: Highlight): void;
  highlightOffsets(start: number, end: number, kind: "thread" | "proposal"): void;
  goToLine(line: number, column?: number): void;
  isComposing(): boolean;
};

type EditorProps = {
  initialContent: string;
  lineSeparator: "\n" | "\r\n";
  onChange(content: string): void;
  onSelectionChange(selection: SelectionSnapshot | null, editorFocused: boolean): void;
  onCompositionEnd(): void;
  onSaveShortcut(): void;
  onAskShortcut(): void;
};

export const Editor = forwardRef<EditorHandle, EditorProps>(function Editor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: props.initialContent,
      extensions: [
        props.lineSeparator === "\r\n" ? EditorState.lineSeparator.of("\r\n") : [],
        history(),
        Prec.high(
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                callbacks.current.onSaveShortcut();
                return true;
              },
            },
            {
              key: "Mod-Enter",
              run: (view) => {
                if (view.state.selection.main.empty) return false;
                callbacks.current.onAskShortcut();
                return true;
              },
            },
          ]),
        ),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        syntaxHighlighting(markdownStyle),
        EditorView.lineWrapping,
        highlightField,
        placeholder("ここに考えを書きはじめましょう"),
        EditorView.contentAttributes.of({ "aria-label": "原稿", lang: "ja", spellcheck: "false" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(editorContent(update.state));
          if (update.selectionSet || update.docChanged || update.focusChanged) {
            callbacks.current.onSelectionChange(snapshot(update.view), update.view.hasFocus);
          }
        }),
        EditorView.domEventHandlers({
          compositionend: () => {
            // composing の解除は compositionend の後に反映されるため、次のタスクで通知する。
            setTimeout(() => callbacks.current.onCompositionEnd(), 0);
            return false;
          },
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // エディタは原稿ごとに一度だけ作る。原稿を切り替えるときは key で作り直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({
    view: () => viewRef.current,
    content: () => (viewRef.current ? editorContent(viewRef.current.state) : ""),
    selection: () => (viewRef.current ? snapshot(viewRef.current) : null),
    replaceOffsets(start, end, text) {
      const view = viewRef.current;
      if (!view) return;
      const from = offsetToPos(view.state, start);
      const to = offsetToPos(view.state, end);
      view.dispatch({ changes: { from, to, insert: text } });
    },
    setContent(content) {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
    },
    focus() {
      viewRef.current?.focus();
    },
    highlight(value) {
      viewRef.current?.dispatch({ effects: setHighlight.of(value) });
    },
    highlightOffsets(start, end, kind) {
      const view = viewRef.current;
      if (!view) return;
      const from = offsetToPos(view.state, start);
      const to = offsetToPos(view.state, end);
      view.dispatch({ effects: setHighlight.of({ from, to, kind }) });
    },
    goToLine(line, column = 1) {
      const view = viewRef.current;
      if (!view) return;
      const target = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines));
      const pos = Math.min(target.from + Math.max(column - 1, 0), target.to);
      view.dispatch({ selection: EditorSelection.cursor(pos), scrollIntoView: true });
      view.focus();
    },
    isComposing: () => viewRef.current?.composing ?? false,
  }));

  return <div className="editor-host" ref={host} />;
});

function snapshot(view: EditorView): SelectionSnapshot | null {
  const range = view.state.selection.main;
  if (range.empty) return null;
  const quote = view.state.sliceDoc(range.from, range.to);
  if (quote.trim() === "") return null;
  const start = posToOffset(view.state, range.from);
  return { from: range.from, to: range.to, quote, start, end: start + quote.length };
}
