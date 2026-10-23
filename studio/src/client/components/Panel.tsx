import { useEffect, useRef, type ReactNode } from "react";
import { SparkIcon } from "./Chrome.tsx";

// 本文の上に重ねる側面パネル。開閉しても本文カラムの幅と位置は変えない。
// 狭い画面では CSS で下からのシートになる。
export function Panel({
  title,
  onClose,
  children,
  footer,
  testId,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    // 開いたときに見出しへフォーカスを移し、スクリーンリーダーに切り替わりを伝える。
    ref.current?.querySelector<HTMLElement>("[data-panel-heading]")?.focus({ preventScroll: true });
  }, [title]);

  return (
    <aside
      ref={ref}
      className="panel"
      aria-label={title}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="paneltop">
        <h2 className="paneltitle" tabIndex={-1} data-panel-heading>
          <SparkIcon />
          <span>{title}</span>
        </h2>
        <button className="x" type="button" aria-label="パネルを閉じて原稿に戻る" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="panelbody">{children}</div>
      {footer ? <div className="panelfoot">{footer}</div> : null}
    </aside>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="tlabel">{children}</span>;
}
