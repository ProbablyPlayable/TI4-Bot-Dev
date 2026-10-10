// The private draft of a tactical action: what the player chose so far, and every state it had,
// for undo and redo. A draft is a script. The engine plays it on a copy of the game each time it
// changes (`Transport.runDraft`), so nothing here decides a rule.
import type { MovementStep } from "./movementPlan";
import type { SaveStorage } from "./savedGame";
import type { DraftOutcome, DraftStep } from "./wire";

/** One state of the draft. */
export interface DraftEntry {
  /** The system that the action activates. Null before it is chosen. */
  system: string | null;
  /** The movement, as "Move fleet" would send it. Null while nothing of it was changed. */
  steps: MovementStep[] | null;
}

export interface Draft {
  /** Every state of the draft, oldest first. Never empty. */
  history: DraftEntry[];
  /** The state that is the draft now. */
  cursor: number;
}

const EMPTY: DraftEntry = { system: null, steps: null };

export const newDraft = (): Draft => ({ history: [EMPTY], cursor: 0 });

export const entryOf = (draft: Draft): DraftEntry => draft.history[draft.cursor] ?? EMPTY;

/** A change is one step of undo. It drops what redo would have brought back. */
const record = (draft: Draft, entry: DraftEntry): Draft => {
  const history = [...draft.history.slice(0, draft.cursor + 1), entry];
  return { history, cursor: history.length - 1 };
};

export const activate = (draft: Draft, system: string): Draft =>
  record(draft, { system, steps: null });

export const setMovement = (draft: Draft, steps: MovementStep[]): Draft =>
  record(draft, { system: entryOf(draft).system, steps });

export const startOver = (draft: Draft): Draft =>
  entryOf(draft).system === null ? draft : record(draft, EMPTY);

export const canUndo = (draft: Draft) => draft.cursor > 0;
export const canRedo = (draft: Draft) => draft.cursor < draft.history.length - 1;
export const undo = (draft: Draft): Draft =>
  canUndo(draft) ? { ...draft, cursor: draft.cursor - 1 } : draft;
export const redo = (draft: Draft): Draft =>
  canRedo(draft) ? { ...draft, cursor: draft.cursor + 1 } : draft;

/** How many steps of a script come before the movement: the action and its system. */
export const BEFORE_MOVEMENT = 2;

/** What the engine is asked to play: the tactical action, its system, its movement. */
export function scriptOf(entry: DraftEntry): DraftStep[] {
  const choose = (option_id: string): DraftStep => ({ kind: "choose", option_id });
  return [
    choose("tactical"),
    ...(entry.system === null ? [] : [choose(entry.system), ...(entry.steps ?? [])]),
  ];
}

/** The game played the whole script: the draft can be sent as it is. */
export const fits = (entry: DraftEntry, outcome: DraftOutcome): boolean =>
  (outcome.stop.kind === "open" || outcome.stop.kind === "complete") &&
  outcome.consumed === scriptOf(entry).length;

const STOPPED: Record<string, string> = {
  Uncertainty: "The draft ends at a roll or a draw. Apply to go on in Live.",
  OtherPlayerRequired: "The draft ends where another seat decides.",
  KnowledgeChanged: "The draft ends where the game would show something new.",
  StepLimit: "The draft is too long to check.",
};

/** Why the game did not play the whole script, in words. Null when it did. */
export function problemOf(entry: DraftEntry, outcome: DraftOutcome): string | null {
  const { stop } = outcome;
  switch (stop.kind) {
    case "open":
    case "complete":
      return null;
    case "refused":
      return stop.step === 0
        ? "A tactical action cannot be drafted from here: the game asks something else first."
        : stop.step < BEFORE_MOVEMENT
          ? `System ${entry.system} cannot be activated now.`
          : `A part of the movement no longer fits. ${stop.reason}`;
    case "stopped":
      return STOPPED[stop.reason] ?? "The draft ends at a decision that it cannot show yet.";
    case "failed":
      return `No draft from here: ${stop.reason}.`;
  }
}

/** The draft as it is kept between two visits. */
export function readDraft(storage: SaveStorage, key: string): Draft | null {
  try {
    const value = JSON.parse(storage.getItem(key) ?? "null");
    return value &&
      Array.isArray(value.history) &&
      value.history.length > 0 &&
      Number.isInteger(value.cursor) &&
      value.cursor >= 0 &&
      value.cursor < value.history.length
      ? { history: value.history, cursor: value.cursor }
      : null;
  } catch {
    return null;
  }
}

export function storeDraft(storage: SaveStorage, key: string, draft: Draft | null): void {
  if (draft) {
    storage.setItem(key, JSON.stringify(draft));
  } else {
    storage.removeItem(key);
  }
}
