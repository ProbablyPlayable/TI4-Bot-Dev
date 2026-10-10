import { expect, it } from "vitest";
import {
  activate,
  canRedo,
  canUndo,
  entryOf,
  fits,
  newDraft,
  problemOf,
  readDraft,
  redo,
  scriptOf,
  setMovement,
  startOver,
  storeDraft,
  undo,
} from "./draft";
import type { MovementStep } from "./movementPlan";
import type { DraftOutcome, DraftStop, SessionUpdate } from "./wire";

const MOVE: MovementStep[] = [
  {
    kind: "move",
    origin: "01",
    unit: "destroyer",
    damaged: false,
    gravity_drive: false,
    ionian: false,
  },
  { kind: "done_moving" },
];
const outcome = (stop: DraftStop, consumed: number): DraftOutcome => ({
  update: {} as SessionUpdate,
  consumed,
  stop,
});

it("is a script: the tactical action, its system, its movement", () => {
  let draft = newDraft();
  expect(scriptOf(entryOf(draft))).toEqual([{ kind: "choose", option_id: "tactical" }]);
  draft = activate(draft, "23");
  expect(scriptOf(entryOf(draft))).toEqual([
    { kind: "choose", option_id: "tactical" },
    { kind: "choose", option_id: "23" },
  ]);
  draft = setMovement(draft, MOVE);
  expect(scriptOf(entryOf(draft))).toEqual([
    { kind: "choose", option_id: "tactical" },
    { kind: "choose", option_id: "23" },
    ...MOVE,
  ]);
});

it("undoes and redoes each change, and a change drops what redo had", () => {
  let draft = setMovement(activate(newDraft(), "23"), MOVE);
  expect(canUndo(draft)).toBe(true);
  expect(canRedo(draft)).toBe(false);
  draft = undo(draft);
  expect(entryOf(draft)).toEqual({ system: "23", steps: null });
  draft = undo(draft);
  expect(entryOf(draft)).toEqual({ system: null, steps: null });
  expect(canUndo(draft)).toBe(false);
  expect(undo(draft)).toBe(draft);
  draft = redo(redo(draft));
  expect(entryOf(draft)).toEqual({ system: "23", steps: MOVE });
  // Another system: the movement of the first one is gone, also for redo.
  draft = activate(undo(draft), "24");
  expect(canRedo(draft)).toBe(false);
  expect(entryOf(draft)).toEqual({ system: "24", steps: null });
  // Start over is a change too: undo brings the draft back.
  draft = startOver(draft);
  expect(entryOf(draft).system).toBeNull();
  expect(entryOf(undo(draft)).system).toBe("24");
  expect(startOver(newDraft())).toEqual(newDraft());
});

it("says whether the game played the whole script, and why not", () => {
  const entry = entryOf(setMovement(activate(newDraft(), "23"), MOVE));
  expect(fits(entry, outcome({ kind: "complete" }, 4))).toBe(true);
  expect(problemOf(entry, outcome({ kind: "complete" }, 4))).toBeNull();
  expect(fits(entry, outcome({ kind: "open" }, 3))).toBe(false);
  const refused = (step: number) =>
    outcome({ kind: "refused", step, reason: "The game does not offer this." }, step);
  expect(fits(entry, refused(2))).toBe(false);
  expect(problemOf(entry, refused(0))).toContain("cannot be drafted from here");
  expect(problemOf(entry, refused(1))).toBe("System 23 cannot be activated now.");
  expect(problemOf(entry, refused(2))).toBe(
    "A part of the movement no longer fits. The game does not offer this.",
  );
  expect(problemOf(entry, outcome({ kind: "stopped", reason: "Uncertainty" }, 3))).toContain(
    "a roll or a draw",
  );
});

it("is kept between two visits, with its history", () => {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
  expect(readDraft(storage, "draft")).toBeNull();
  const draft = undo(setMovement(activate(newDraft(), "23"), MOVE));
  storeDraft(storage, "draft", draft);
  expect(readDraft(storage, "draft")).toEqual(draft);
  stored.set("draft", '{"history":[],"cursor":0}');
  expect(readDraft(storage, "draft")).toBeNull();
  storeDraft(storage, "draft", null);
  expect(stored.has("draft")).toBe(false);
});
