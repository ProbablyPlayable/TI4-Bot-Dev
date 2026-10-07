import { useEffect, useRef, type ReactNode } from "react";
import type {
  ActionView,
  FooterView,
  HelpView,
  PillView,
  StepContentView,
  TaskView,
} from "../../model";
import { Badge, Button, Hint, StepTabs, Trail, cx, type TrailItem } from "../../ui";
import { ActionButton, useDispatch } from "../context";
import { Blocks } from "../flows/Blocks";
import { ActivationStep } from "../steps/ActivationStep";
import { InvasionStep, SpaceCombatStep } from "../steps/BattleSteps";
import { MovementStep } from "../steps/MovementStep";
import { ProductionStep } from "../steps/ProductionStep";

function StepContent({ view }: { view: StepContentView }) {
  switch (view.kind) {
    case "activation":
      return <ActivationStep view={view} />;
    case "movement":
      return <MovementStep view={view} />;
    case "combat":
      return <SpaceCombatStep view={view} />;
    case "invasion":
      return <InvasionStep view={view} />;
    case "production":
      return <ProductionStep view={view} />;
  }
}

interface TaskPanelProps {
  heading: string;
  pill: PillView | null;
  trail: TrailItem[];
  edit?: TaskView["edit"];
  /** Rules and explanations. They are shown on hover or click only. */
  help: HelpView[];
  footer: FooterView;
  /** Scroll position is kept while this stays the same. */
  contentKey: string;
  labelledBy?: string;
  reveal: string | null;
  children: ReactNode;
}

/** The open step: heading with its state, the content, and a footer that says what the main button does. */
function TaskPanel({
  heading,
  pill,
  trail,
  edit,
  help,
  footer,
  contentKey,
  labelledBy,
  reveal,
  children,
}: TaskPanelProps) {
  const dispatch = useDispatch();
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal)
      content.current
        ?.querySelector(`[data-link~="${reveal}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [reveal]);
  return (
    <section
      id="step-panel"
      role="tabpanel"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className="flex min-h-0 min-w-0 flex-1 flex-col outline-none"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line px-5 py-[9px]">
        <h2 className="text-lg font-semibold tracking-[-.2px]">{heading}</h2>
        {pill && <Badge tone={pill.tone}>{pill.label}</Badge>}
        {help.length > 0 && (
          <Hint label={`Rules: ${heading}`}>
            {help.map((item) => (
              <p key={item.title}>
                <strong className="block">{item.title}</strong>
                {item.text}
              </p>
            ))}
          </Hint>
        )}
        <Trail items={trail} />
        {edit && (
          <Button
            tone="quiet"
            size="sm"
            icon="edit"
            className="ml-auto"
            disabled={edit.disabled}
            title={edit.hint}
            onClick={() => dispatch({ type: "editStep", step: edit.step })}
          >
            {edit.label}
          </Button>
        )}
      </div>
      <div
        key={contentKey}
        ref={content}
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-5 pt-3 pb-4"
      >
        {children}
      </div>
      <footer className="flex items-center justify-between gap-[15px] border-t border-line bg-surface px-5 py-2.5">
        <span
          id="footer-note"
          role={footer.error ? "status" : undefined}
          className={cx("text-sm", footer.error ? "text-red" : "text-muted")}
        >
          {footer.note}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {footer.actions.map((action) => (
            <ActionButton key={action.label} view={action} describedBy="footer-note" />
          ))}
        </div>
      </footer>
    </section>
  );
}

/**
 * The action panel: one frame for every action. A tactical action has five steps, a strategic action
 * has two, a component action has none. Live, Draft and History use the same frame.
 * The panel has one width for every step.
 */
export function ActionPanel({ view, reveal }: { view: ActionView; reveal: string | null }) {
  const dispatch = useDispatch();
  const away = view.kind === "tactical" && view.current !== null && view.selected !== view.current;
  const uncommitted = view.kind === "tactical" ? view.uncommitted : null;
  return (
    <aside className="flex min-h-0 min-w-0 flex-1 flex-col">
      {view.past && (
        <div className="flex items-center justify-between gap-2.5 border-b border-green/25 bg-green/[.07] py-1.5 pr-2.5 pl-4 text-sm">
          <span>
            <strong>History</strong> · {view.past.label} · read-only
          </span>
          <Button size="sm" iconAfter="arrow" onClick={() => dispatch({ type: "closeHistory" })}>
            Back to Live
          </Button>
        </div>
      )}
      <div className="flex min-h-10 items-center gap-2 border-b border-line bg-surface py-1 pr-2 pl-4">
        <strong className="whitespace-nowrap">{view.title}</strong>
        <span className="min-w-0 truncate text-sm text-muted">{view.subtitle}</span>
        <span className="ml-auto" />
        {view.badge && <Badge tone={view.badge.tone}>{view.badge.label}</Badge>}
      </div>
      {view.tabs.length > 0 && (
        <StepTabs
          label={`${view.title} steps`}
          tabs={view.tabs}
          selected={view.selected}
          current={view.current}
          onSelect={(step) => dispatch({ type: "selectStep", step })}
        />
      )}
      {(uncommitted || away) && (
        <div className="flex flex-none items-center justify-end gap-1.5 border-b border-line px-3 py-[5px]">
          {uncommitted && (
            <Button
              tone="quiet"
              size="sm"
              icon="edit"
              onClick={() => dispatch({ type: "returnToEdit" })}
            >
              {uncommitted.name} · uncommitted
            </Button>
          )}
          {away && (
            <Button
              tone="quiet"
              size="sm"
              iconAfter="arrow"
              onClick={() => dispatch({ type: "returnToCurrent" })}
            >
              Go to current
            </Button>
          )}
        </div>
      )}
      {view.kind === "tactical" ? (
        <TaskPanel
          heading={view.task.title}
          pill={view.task.pill}
          trail={view.task.trail}
          edit={view.task.edit}
          help={view.task.help}
          footer={view.task.footer}
          contentKey={view.contentKey}
          labelledBy={`step-tab-${view.selected}`}
          reveal={reveal}
        >
          <StepContent view={view.task.content} />
        </TaskPanel>
      ) : (
        <TaskPanel
          heading={view.heading}
          pill={view.pill}
          trail={view.trail}
          help={view.help}
          footer={view.footer}
          contentKey={view.contentKey}
          reveal={reveal}
        >
          <Blocks blocks={view.blocks} />
        </TaskPanel>
      )}
    </aside>
  );
}
