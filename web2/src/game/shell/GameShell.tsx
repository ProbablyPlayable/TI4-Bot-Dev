import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { GameSession, Intent } from "../../model";
import { Badge, Button, Dialog, InlineNote, LiveRegion, Toast } from "../../ui";
import { ActionPanel } from "../action/ActionPanel";
import { Board } from "../board/Board";
import { GameProvider } from "../context";
import { LinkProvider } from "../link";
import { PlayerTable } from "../players/PlayerTable";
import { ReferenceDrawer } from "./Reference";
import { Toolbar } from "./Toolbar";

const ACCENT = {
  draft: "var(--color-gold)",
  live: "var(--color-cyan)",
  done: "var(--color-green)",
};

/**
 * The game screen: one toolbar, then the board and the right column (player table, action panel).
 * The right column has one fixed width. The design target is 1920×1080 or larger; see AGENTS.md.
 * It needs a `GameSession` and nothing else. State that only changes what is in view lives here.
 */
export function GameShell({ session }: { session: GameSession }) {
  const { view } = session;
  const [drawer, setDrawer] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(true);
  const [applyOpen, setApplyOpen] = useState(false);
  const toggleDrawer = (id: string) => setDrawer((now) => (now === id ? null : id));

  const dispatch = useCallback(
    (intent: Intent) => {
      if (intent.type === "openApply") return setApplyOpen(true);
      if (intent.type === "inspectLogEntry") setDrawer(null);
      session.dispatch(intent);
    },
    [session],
  );
  useEffect(() => {
    if (!view.apply) setApplyOpen(false);
  }, [view.apply]);

  return (
    <GameProvider seats={view.seats} dispatch={dispatch}>
      <LinkProvider>
        <main
          className="flex min-h-0 flex-col"
          style={{ "--accent": ACCENT[view.accent] } as CSSProperties}
        >
          <Toolbar view={view.toolbar} drawer={drawer} onDrawer={toggleDrawer} />
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_1040px]">
            <Board view={view.board} logOpen={drawer === "log"} onLog={() => toggleDrawer("log")}>
              {drawer && (
                <ReferenceDrawer
                  id={drawer}
                  view={view.reference}
                  players={view.players.rows}
                  onClose={() => setDrawer(null)}
                />
              )}
            </Board>
            <div className="flex min-h-0 min-w-0 flex-col border-l border-line">
              <PlayerTable
                view={view.players}
                open={tableOpen}
                onToggle={() => setTableOpen(!tableOpen)}
                onOpenSeat={(seat) => toggleDrawer(`player:${seat}`)}
              />
              <ActionPanel view={view.action} reveal={view.reveal} />
            </div>
          </div>
          <Dialog
            open={applyOpen && !!view.apply}
            onClose={() => setApplyOpen(false)}
            lead={<Badge tone="draft">Private draft</Badge>}
            title="Apply to Live?"
            description="These recorded choices are committed to the live game in order."
            actions={
              <>
                <Button tone="quiet" autoFocus onClick={() => setApplyOpen(false)}>
                  Cancel
                </Button>
                <Button
                  tone="primary"
                  iconAfter="arrow"
                  onClick={() => {
                    setApplyOpen(false);
                    session.dispatch({ type: "confirmApply" });
                  }}
                >
                  Apply to Live
                </Button>
              </>
            }
          >
            <ul className="my-3.5 rounded border border-line">
              {view.apply?.items.map((item) => (
                <li key={item} className="px-3 py-[9px] text-sm [li+&]:border-t [li+&]:border-line">
                  {item}
                </li>
              ))}
            </ul>
            <InlineNote strong={view.apply?.cost}>{view.apply?.note}</InlineNote>
          </Dialog>
          <Toast message={view.toast} />
          <LiveRegion text={view.announcement} />
        </main>
      </LinkProvider>
    </GameProvider>
  );
}
