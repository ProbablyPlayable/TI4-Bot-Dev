import { useEffect, useMemo, useState } from "react";
import type { GameSession, Intent } from "../model";
import type { LocalState } from "./select/action";
import { selectShell } from "./select/shell";
import type { Transport } from "./transport";
import type { SessionUpdate } from "./wire";

const NOTHING: LocalState = { inspected: null, staged: null, sent: null, error: null };

export interface LiveSession {
  /** Null until the first update. */
  session: GameSession | null;
  /** Why the game stopped, or cannot start. */
  error: string | null;
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
        setLocal((now) => ({ ...now, staged: null, error: event.message }));
        return;
      }
      setUpdate(event.update);
      // A new choice starts with nothing staged. The inspector stays where the player left it.
      setLocal((now) => ({ ...now, staged: null, sent: null }));
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
        case "clearChoice":
          return setLocal((now) => ({ ...now, staged: null }));
        case "flow":
          if (intent.action === "resolve" && pending && local.staged) {
            transport.submitChoice(pending.nonce, local.staged);
            setLocal((now) => ({ ...now, staged: null, sent: pending.nonce }));
          }
          return;
        default:
          // The other intents belong to screens that local play does not have yet.
          return;
      }
    };
    return { view: selectShell(update, local), dispatch };
  }, [update, local, transport]);

  return { session, error: local.error };
}
