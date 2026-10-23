import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

export type HighlightKind = "thread" | "proposal";
export type Highlight = { from: number; to: number; kind: HighlightKind } | null;

export const setHighlight = StateEffect.define<Highlight>();

const marks: Record<HighlightKind, Decoration> = {
  thread: Decoration.mark({ class: "cm-studio-thread", attributes: { "data-highlight": "thread" } }),
  proposal: Decoration.mark({ class: "cm-studio-proposal", attributes: { "data-highlight": "proposal" } }),
};

// 対話中の箇所を、編集に追従させながら控えめに示す。
export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlight)) continue;
      const highlight = effect.value;
      next =
        highlight && highlight.to > highlight.from
          ? Decoration.set([marks[highlight.kind].range(highlight.from, highlight.to)])
          : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});
