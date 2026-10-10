import { expect, it } from "vitest";
import loadUpdate from "./fixtures/update-load.json";
import movementUpdate from "./fixtures/update-movement.json";
import {
  type MovementDraft,
  fill,
  poolLeft,
  resetOrigin,
  setCount,
  setLoad,
  setShip,
  loadKey,
  shipKey,
} from "./movementDraft";
import { type MovementStep, draftOf, planAnswer, stepsOf } from "./movementPlan";
import type { Choice, MovementFacts, SessionUpdate } from "./wire";

// Updates of a real game, written by the engine (seat a is Sol; it activated the system next
// to its home, where it has two carriers, a destroyer, three fighters and five infantry):
//   cargo run -p ti4-wasm --example record -- 3 8 1 5 pok8imperial no tactical 23 > web2/src/session/fixtures/update-movement.json
//   cargo run -p ti4-wasm --example record -- 3 8 1 6 pok8imperial no tactical 23 'move|01|0' > web2/src/session/fixtures/update-load.json
const moving = movementUpdate as unknown as SessionUpdate;
const loading = loadUpdate as unknown as SessionUpdate;
const facts = moving.tactical as MovementFacts;
const FIGHTERS = facts.cargo.findIndex((pool) => pool.unit === "fighter");
const INFANTRY = facts.cargo.findIndex((pool) => pool.unit === "sol_infantry");
const [CARRIER, CARRIER_2, DESTROYER] = ["01|0", "01|1", "01|2"];

const staged = (...changes: ((draft: MovementDraft) => MovementDraft)[]) =>
  changes.reduce((draft, change) => change(draft), {} as MovementDraft);
const ship = (id: string) => (draft: MovementDraft) => setShip(facts, draft, id, true);
const load = (id: string, pool: number, count: number) => (draft: MovementDraft) =>
  setLoad(facts, draft, id, pool, count);

it("has the facts of the engine for the fixture", () => {
  expect(facts.active).toBe("23");
  expect(facts.ships.map((item) => [item.unit, !!item.move])).toEqual([
    ["sol_carrier", true],
    ["sol_carrier", true],
    ["destroyer", true],
  ]);
  expect(facts.cargo.map((pool) => [pool.unit, pool.source, pool.count])).toEqual([
    ["fighter", null, 3],
    ["sol_infantry", "jord", 5],
  ]);
});

it("loads a ship that moves, within its hold and what is left", () => {
  // A ship that stays has no hold.
  expect(load(CARRIER, INFANTRY, 2)({})).toEqual({});
  const draft = staged(ship(CARRIER), load(CARRIER, INFANTRY, 2));
  expect(draft).toEqual({ [CARRIER]: { [INFANTRY]: 2 } });
  expect(poolLeft(facts, draft, INFANTRY)).toBe(3);
  // The hold has six slots, and there are three fighters.
  const full = staged(ship(CARRIER), load(CARRIER, INFANTRY, 9), load(CARRIER, FIGHTERS, 9));
  expect(full[CARRIER]).toEqual({ [INFANTRY]: 5, [FIGHTERS]: 1 });
  // The other carrier gets what the first left.
  const both = staged(
    () => full,
    ship(CARRIER_2),
    load(CARRIER_2, INFANTRY, 2),
    (draft) => setLoad(facts, draft, CARRIER_2, FIGHTERS, 9),
  );
  expect(both[CARRIER_2]).toEqual({ [FIGHTERS]: 2 });
  // A destroyer has no hold.
  expect(staged(ship(DESTROYER), load(DESTROYER, FIGHTERS, 1))).toEqual({ [DESTROYER]: {} });
});

it("takes a ship back with its hold, and a system with all its ships", () => {
  const draft = staged(ship(CARRIER), load(CARRIER, INFANTRY, 2), ship(DESTROYER));
  expect(setShip(facts, draft, CARRIER, false)).toEqual({ [DESTROYER]: {} });
  expect(resetOrigin(draft, "01")).toEqual({});
  expect(resetOrigin(draft, "23")).toEqual(draft);
});

it("reads the intents of the sheet: a token, a slot, Fill", () => {
  let draft = setCount(facts, {}, shipKey(CARRIER), 1);
  draft = setCount(facts, draft, shipKey(CARRIER_2), 1);
  draft = setCount(facts, draft, loadKey(CARRIER, FIGHTERS), 1);
  expect(draft).toEqual({ [CARRIER]: { [FIGHTERS]: 1 }, [CARRIER_2]: {} });
  // Fill loads the kind on every ship that leaves, in order, until none is left.
  draft = fill(facts, draft, "01", INFANTRY);
  expect(draft).toEqual({ [CARRIER]: { [FIGHTERS]: 1, [INFANTRY]: 5 }, [CARRIER_2]: {} });
  draft = setCount(facts, draft, loadKey(CARRIER, INFANTRY), 4);
  draft = setCount(facts, draft, shipKey(CARRIER_2), 0);
  expect(draft).toEqual({ [CARRIER]: { [FIGHTERS]: 1, [INFANTRY]: 4 } });
  expect(setCount(facts, draft, "something else", 1)).toBe(draft);
});

const plan = () =>
  stepsOf(
    facts,
    staged(ship(CARRIER), load(CARRIER, INFANTRY, 2), load(CARRIER, FIGHTERS, 1), ship(DESTROYER)),
  );

it("turns a staged movement into steps, ship by ship", () => {
  expect(
    plan().map((step) => (step.kind === "move" || step.kind === "load" ? step.unit : step.kind)),
  ).toEqual([
    "sol_carrier",
    "fighter",
    "sol_infantry",
    "sol_infantry",
    "done_loading",
    "destroyer",
    "done_moving",
  ]);
  expect(plan()[2]).toEqual({
    kind: "load",
    origin: "01",
    pickup_system: "01",
    unit: "sol_infantry",
    source: "jord",
    damaged: false,
    galvanized: false,
  });
  // Moving nothing is a movement too.
  expect(stepsOf(facts, {})).toEqual([{ kind: "done_moving" }]);
});

it("stages the steps of a stopped plan again", () => {
  const draft = staged(ship(CARRIER), load(CARRIER, INFANTRY, 2), ship(CARRIER_2), ship(DESTROYER));
  expect(draftOf(facts, stepsOf(facts, draft))).toEqual(draft);
  // The rest of a plan: the first carrier has moved, so the second is the first that is left.
  const rest = stepsOf(facts, staged(ship(CARRIER_2), load(CARRIER_2, FIGHTERS, 2)));
  expect(draftOf(facts, rest)).toEqual({ [CARRIER]: { [FIGHTERS]: 2 } });
  // A step that no longer fits is left out.
  const gone: MovementStep[] = [
    {
      kind: "move",
      origin: "99",
      unit: "cruiser",
      damaged: false,
      gravity_drive: false,
      ionian: false,
    },
    { kind: "done_moving" },
  ];
  expect(draftOf(facts, gone)).toEqual({});
});

const moveChoice = moving.pending_choice!.choice;
const loadChoice = loading.pending_choice!.choice;
const idOf = (choice: Choice, answer: ReturnType<typeof planAnswer>) =>
  answer.kind === "answer" ? choice.options[answer.index].id : answer.kind;

it("answers each choice of the game with the option that the step names", () => {
  const steps = plan();
  const first = planAnswer(steps, 0, moveChoice, "a");
  expect(idOf(moveChoice, first)).toBe("move|01|0");
  expect(first).toMatchObject({ next: 1 });
  expect(idOf(loadChoice, planAnswer(steps, 1, loadChoice, "a"))).toBe("load|0");
  expect(idOf(loadChoice, planAnswer(steps, 2, loadChoice, "a"))).toBe("load|3");
  expect(idOf(loadChoice, planAnswer(steps, 4, loadChoice, "a"))).toBe("done_loading");
  expect(idOf(moveChoice, planAnswer(steps, 5, moveChoice, "a"))).toBe("move|01|2");
  expect(idOf(moveChoice, planAnswer(steps, 6, moveChoice, "a"))).toBe("done_moving");
  expect(planAnswer(steps, 7, moveChoice, "a")).toEqual({ kind: "done" });
});

it("follows the three rules of the server's batch", () => {
  const steps = plan();
  // A hold that closed itself: the game asks for the next ship, and "done_loading" is passed over.
  expect(planAnswer(steps, 4, moveChoice, "a")).toMatchObject({ kind: "answer", next: 6 });
  // A hold that the plan does not load is declined, and no step is used.
  const empty = stepsOf(facts, staged(ship(DESTROYER)));
  const declined = planAnswer(empty, 1, loadChoice, "a");
  expect(idOf(loadChoice, declined)).toBe("done_loading");
  expect(declined).toMatchObject({ next: 1 });
  // Another question stops the plan: a reaction window, or a choice of another seat.
  const reaction: Choice = {
    ...moveChoice,
    context: { subtype: "reaction_after_SHIP_MOVED", actor: "a" },
  };
  expect(planAnswer(steps, 5, reaction, "a").kind).toBe("interrupted");
  expect(planAnswer(steps, 5, { ...moveChoice, player: "c" }, "a").kind).toBe("interrupted");
  expect(planAnswer(steps, 1, moveChoice, "a").kind).toBe("interrupted");
});

it("refuses a step that the game does not offer", () => {
  const steps: MovementStep[] = [
    {
      kind: "move",
      origin: "01",
      unit: "dreadnought",
      damaged: false,
      gravity_drive: false,
      ionian: false,
    },
    { kind: "done_moving" },
  ];
  expect(planAnswer(steps, 0, moveChoice, "a")).toEqual({
    kind: "mismatch",
    reason: "The game does not offer to move dreadnought from 01.",
  });
  // Gravity Drive is part of what a step names.
  const boosted = plan().map((step) =>
    step.kind === "move" ? { ...step, gravity_drive: true } : step,
  );
  expect(planAnswer(boosted, 0, moveChoice, "a").kind).toBe("mismatch");
});
