import { forwardRef } from "react";

type Props = {
  position: { left: number; top: number };
  onAsk(mode: "interpret" | "counterpoint"): void;
  onFocusChange(focused: boolean): void;
  onEscape(): void;
};

// 選択箇所の上に控えめに出す。ボタンを押すまではAIを呼ばない。
export const SelectionBar = forwardRef<HTMLDivElement, Props>(function SelectionBar(
  { position, onAsk, onFocusChange, onEscape },
  ref,
) {
  return (
    <div
      ref={ref}
      className="floatbar"
      role="toolbar"
      aria-label="選択箇所についてAIに尋ねる"
      style={{ left: position.left, top: position.top }}
      onFocus={() => onFocusChange(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocusChange(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onEscape();
        }
      }}
    >
      {/* mousedown で既定動作を止め、エディタの選択とフォーカスを保つ。 */}
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAsk("interpret")}>
        <span aria-hidden="true">✧</span> どう読める？
      </button>
      <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAsk("counterpoint")}>
        <span aria-hidden="true">↗</span> 別の見方は？
      </button>
    </div>
  );
});
