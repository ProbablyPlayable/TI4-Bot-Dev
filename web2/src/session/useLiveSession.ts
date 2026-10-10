import { useEffect, useMemo, useState } from "react";
import type { GameSession, Intent } from "../model";
import { fill, poolOfSource, resetOrigin, setCount } from "./movementDraft";
import { draftOf, stepsOf } from "./movementPlan";
import type { LocalState } from "./select/action";
import { selectShell } from "./select/shell";
import { tacticalFacts } from "./select/tactical";
import type { Transport } from "./transport";
import type { SessionUpdate } from "./wire";

const NOTHING: LocalState = {
  inspected: null,
  staged: null,
  sent: null,
  error: null,
  replaying: null,
  canUndo: false,
  movement: {},
  step: null,
  remaining: null,
  planNote: null,
};

/** The label of a system as the activation step lists it, for the search field. */
const sameSystem = (query: string, id: string) =>
  query.trim() === id || query.trim().endsWith(`#${id}`);

export interface LiveSession {
  /** Null until the first update. */
  session: GameSession | null;
  /** Why the game stopped, or cannot start. */
  error: string | null;
  /** A saved game is played again: how many of its answers are done. */
  replaying: { done: number; total: number } | null;
}

/**
 * A `GameSession` on a transport: the game comes from the updates, and what the player stages
 * between two updates is kept here. Only the main button sends something.
 */
export function useLiveSession(transport: Transport | null): LiveSession {
  const [update, setUpdate] = useState<SessionUpdate | null>(null);
  const [local, setLocal] = useState<LocalState>(NOTHING);

  useEffect(() => {
    setUpdate(null);
    setLocal(NOTHING);
    return transport?.subscribe((event) => {
      if (event.kind === "error") {
        setLocal((now) => ({ ...now, staged: null, replaying: null, error: event.message }));
        return;
      }
      if (event.kind === "replaying") {
        const { done, total } = event;
        setLocal((now) => ({
          ...now,
          staged: null,
          sent: null,
          error: null,
          replaying: { done, total },
        }));
        return;
      }
      setUpdate(event.update);
      // A new choice starts with nothing staged. The inspector stays where the player left it.
      setLocal((now) => {
        const facts = event.update.tactical;
        const stopped = event.plan;
        // A movement that another decision stopped is staged again when the movement goes on.
        let remaining =
          stopped?.interrupted && stopped.remaining.length
            ? { destination: stopped.destination, steps: stopped.remaining }
            : now.remaining;
        let movement = {};
        let planNote =
          stopped && !stopped.interrupted ? { text: stopped.reason, error: true } : null;
        if (facts?.kind === "movement") {
          const again = stopped && !stopped.interrupted ? stopped.remaining : remaining?.steps;
          if (again && (stopped?.destination ?? remaining?.destination) === facts.active) {
            movement = draftOf(facts, again);
            planNote ??= {
              text: "Another decision stopped the movement. What did not move is staged again.",
              error: false,
            };
          }
          remaining = null;
        } else if (facts?.kind === "activation") {
          remaining = null;
        }
        return {
          ...now,
          staged: null,
          sent: null,
          error: null,
          replaying: null,
          canUndo: event.canUndo,
          movement,
          step: null,
          remaining,
          planNote,
        };
      });
    });
  }, [transport]);

  const session = useMemo((): GameSession | null => {
    if (!update || !transport) {
      return null;
    }
    const pending = local.sent === update.pending_choice?.nonce ? null : update.pending_choice;
    const stage = (option: string) => {
      if (pending?.choice.options.some((item) => item.id === option)) {
        setLocal((now) => ({ ...now, staged: now.staged === option ? null : option }));
      }
    };
    const facts = tacticalFacts(update, local);
    const moving = facts?.kind === "movement" ? facts : null;
    /** A change of the staged movement. It clears the note of the last plan. */
    const draft = (change: (now: LocalState["movement"]) => LocalState["movement"]) =>
      setLocal((now) => ({ ...now, movement: change(now.movement), planNote: null }));
    const send = () => {
      if (!pending) {
        return;
      }
      if (moving) {
        transport.submitPlan(pending.nonce, {
          destination: moving.active,
          steps: stepsOf(moving, local.movement),
        });
        return setLocal((now) => ({ ...now, sent: pending.nonce, planNote: null }));
      }
      if (local.staged) {
        transport.submitChoice(pending.nonce, local.staged);
        setLocal((now) => ({ ...now, staged: null, sent: pending.nonce }));
      }
    };
    const dispatch = (intent: Intent) => {
      switch (intent.type) {
        case "inspectSystem":
          return setLocal((now) => ({ ...now, inspected: intent.system }));
        case "closeInspector":
          return setLocal((now) => ({ ...now, inspected: null }));
        case "chooseOption":
          return stage(intent.option);
        case "toggleSystem":
          return stage(intent.system);
        case "findSystem": {
          const found = pending?.choice.options.find((item) => sameSystem(intent.query, item.id));
          if (found && facts?.kind === "activation") {
            setLocal((now) => ({ ...now, staged: found.id }));
          }
          return;
        }
        case "clearChoice":
          return setLocal((now) => ({ ...now, staged: null }));
        case "undo":
          return transport.undo();
        case "flow":
          return intent.action === "resolve" && !facts ? send() : undefined;
        // The steps of a tactical action.
        case "commitEdit":
          return facts ? send() : undefined;
        case "selectStep":
          return setLocal((now) => ({ ...now, step: moving && intent.step === 0 ? 0 : null }));
        case "returnToCurrent":
          return setLocal((now) => ({ ...now, step: null }));
        case "setCount":
          return moving && draft((now) => setCount(moving, now, intent.key, intent.value));
        case "fillHold": {
          const pool = poolOfSource(intent.source);
          const origin = intent.key.startsWith("origin:") ? intent.key.slice(7) : null;
          return (
            moving &&
            pool !== null &&
            origin !== null &&
            draft((now) => fill(moving, now, origin, pool))
          );
        }
        case "resetOrigin":
          return moving && draft((now) => resetOrigin(now, intent.system));
        case "cancelEdit":
          return moving && draft(() => ({}));
        default:
          // The other intents belong to screens that local play does not have yet.
          return;
      }
    };
    return { view: selectShell(update, local), dispatch };
  }, [update, local, transport]);

  return { session, error: local.error, replaying: local.replaying };
}
