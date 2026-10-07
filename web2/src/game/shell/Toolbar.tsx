import type { ToolbarView, Workspace } from "../../model";
import { Button, Menu, cx } from "../../ui";
import { useDispatch } from "../context";

export const REFERENCES = [
  ["objectives", "Objectives"],
  ["technology", "Technology"],
  ["cards", "Cards"],
  ["log", "Log"],
] as const;

/** One header row: status, workspace, reference sheets, and the controls of the draft. */
export function Toolbar({
  view,
  drawer,
  onDrawer,
}: {
  view: ToolbarView;
  drawer: string | null;
  onDrawer: (id: string) => void;
}) {
  const dispatch = useDispatch();
  const tab = (mode: Workspace, label: string, disabled = false, title?: string) => (
    <button
      type="button"
      aria-pressed={view.workspace === mode}
      disabled={disabled}
      title={title}
      onClick={() => dispatch({ type: "workspace", mode })}
      className="rounded-[5px] border border-transparent px-3.5 py-1 text-sm font-strong text-muted disabled:opacity-40 aria-pressed:border-line aria-pressed:bg-raised aria-pressed:text-accent"
    >
      {label}
    </button>
  );
  return (
    <header className="flex min-h-12 items-center gap-3.5 border-b border-line bg-surface px-4 py-1.5 max-[860px]:flex-wrap max-[860px]:gap-x-2.5 max-[860px]:gap-y-1.5">
      <div className="flex min-w-0 flex-col text-xs leading-[1.3] text-muted">
        <span className="max-[1180px]:hidden">
          Round {view.round} · {view.phase}
        </span>
        <strong className="truncate text-sm font-semibold text-text">
          <i className="mr-1.5 mb-0.5 inline-block size-1.5 rounded-full bg-accent" />
          {view.status}
        </strong>
      </div>
      <nav
        aria-label="Workspace"
        className="flex gap-0.5 rounded-lg border border-line bg-well p-[3px]"
      >
        {tab("live", "Live")}
        {tab("draft", "Draft", !!view.draftLocked, view.draftLocked ?? undefined)}
        {view.past && (
          <>
            {tab("history", `History · ${view.past.label}`)}
            <button
              type="button"
              className={cx("rounded-[5px] px-2 text-sm text-muted hover:text-text")}
              aria-label="Close history view"
              title="Close history view"
              onClick={() => dispatch({ type: "closeHistory" })}
            >
              ✕
            </button>
          </>
        )}
      </nav>
      <nav
        aria-label="Reference"
        className="ml-auto flex gap-1 max-[860px]:order-4 max-[860px]:ml-0 max-[860px]:basis-full max-[860px]:overflow-x-auto"
      >
        {REFERENCES.map(([id, label]) => (
          <Button
            key={id}
            tone="quiet"
            size="sm"
            active={drawer === id}
            aria-expanded={drawer === id}
            onClick={() => onDrawer(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {view.draft && (
        <div className="flex items-center gap-1.5 max-[860px]:ml-auto">
          <Button
            tone="quiet"
            size="icon"
            icon="undo"
            aria-label="Undo"
            title="Undo"
            disabled={!view.draft.canUndo}
            onClick={() => dispatch({ type: "undo" })}
          />
          <Button
            tone="quiet"
            size="icon"
            icon="redo"
            aria-label="Redo"
            title="Redo"
            disabled={!view.draft.canRedo}
            onClick={() => dispatch({ type: "redo" })}
          />
          <Button
            tone="primary"
            iconAfter="arrow"
            title={view.draft.applyHint}
            disabled={!view.draft.canApply}
            onClick={() => dispatch({ type: "openApply" })}
          >
            Apply to Live
          </Button>
          <Menu
            label="More draft actions"
            items={[
              { label: "Start over", onSelect: () => dispatch({ type: "startOver" }) },
              { label: "Discard draft", onSelect: () => dispatch({ type: "discardDraft" }) },
            ]}
          />
        </div>
      )}
    </header>
  );
}
