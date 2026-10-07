import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";
import { Button, CloseButton } from "./Button";
import type { IconName } from "./Icon";

export interface MenuItem {
  label: string;
  onSelect: () => void;
}

/** A small menu behind an icon button. */
export function Menu({
  label,
  icon = "more",
  items,
}: {
  label: string;
  icon?: IconName;
  items: MenuItem[];
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <Button
        tone="quiet"
        size="icon"
        icon={icon}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+6px)] right-0 z-10 grid min-w-[170px] rounded-lg border border-[#415065] bg-raised p-[5px] shadow-pop"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="rounded-[5px] px-2.5 py-2 text-left text-sm hover:bg-[#2a3a50]"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Shown above the title, for example a badge. */
  lead?: ReactNode;
  description?: string;
  children?: ReactNode;
  actions: ReactNode;
}

export function Dialog({
  open,
  onClose,
  title,
  lead,
  description,
  children,
  actions,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      aria-describedby={description ? "dialog-description" : undefined}
      className="m-auto w-[min(470px,calc(100vw-32px))] rounded-xl border border-[#415065] bg-surface p-0 text-text shadow-[0_30px_100px_#0007] backdrop:bg-[#02050ac9] backdrop:backdrop-blur-[3px]"
    >
      {open && (
        <>
          <div className="p-[22px]">
            {lead}
            <h2 id="dialog-title" className="mt-2.5 text-[20px] font-bold">
              {title}
            </h2>
            {description && (
              <p id="dialog-description" className="mt-1.5 mb-3.5 text-sm text-muted">
                {description}
              </p>
            )}
            {children}
          </div>
          <div className="flex justify-end gap-[9px] border-t border-line px-[22px] py-3.5">
            {actions}
          </div>
        </>
      )}
    </dialog>
  );
}

/** A reference sheet that slides over the board. */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={title}
      className="absolute inset-y-0 left-0 z-5 flex w-[min(420px,94%)] flex-col border-r border-line bg-surface shadow-[12px_0_30px_#0006]"
    >
      <div className="flex items-center justify-between border-b border-line py-2 pr-2.5 pl-4">
        <h2 className="text-md font-semibold">{title}</h2>
        <CloseButton label={`Close ${title}`} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pt-1 pb-4 text-sm">{children}</div>
    </aside>
  );
}

/** Shows the latest message for a short time. A new `id` shows it again. */
export function Toast({ message }: { message: { id: number; text: string } | null }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!message) return setVisible(false);
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(timer);
  }, [message?.id]);
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        "pointer-events-none fixed bottom-24 left-1/2 z-20 w-max max-w-[calc(100vw-32px)] -translate-x-1/2 rounded border border-[#4c6885] bg-[#223346] px-4 py-2.5 text-sm shadow-[0_10px_30px_#0005] transition-[opacity,translate] duration-200",
        visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
      )}
    >
      {message?.text}
    </div>
  );
}

export function LiveRegion({ text }: { text: string }) {
  return (
    <div className="sr-only" role="status" aria-live="polite">
      {text}
    </div>
  );
}
