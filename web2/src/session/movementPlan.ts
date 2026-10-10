// A staged movement as the steps that the game is asked for, and back. The steps name what is
// moved and loaded, not the ids of the options: the game numbers its options again after each ship.
import { type MovementDraft, canMove, setLoad, setShip, shipId, shipOf } from "./movementDraft";
import type { Choice, ChoiceOption, MovementFacts } from "./wire";

/** Compare `MovementOnlyStep` in `crates/ti4-server/src/session/batch.rs`. */
export type MovementStep =
  | {
      kind: "move";
      origin: string;
      unit: string;
      damaged: boolean;
      gravity_drive: boolean;
      ionian: boolean;
    }
  | {
      kind: "load";
      /** The system that the ship starts in. */
      origin: string;
      /** The system where the unit is picked up. */
      pickup_system: string;
      unit: string;
      /** The planet, or null for the space area. */
      source: string | null;
      damaged: boolean;
      galvanized: boolean;
    }
  | { kind: "done_loading" }
  | { kind: "done_moving" };

export interface MovementPlan {
  /** The active system. */
  destination: string;
  steps: MovementStep[];
}

/** The steps of a staged movement: each ship with its hold, in the order of the facts. */
export function stepsOf(facts: MovementFacts, draft: MovementDraft): MovementStep[] {
  const steps: MovementStep[] = [];
  for (const ship of facts.ships) {
    const hold = draft[shipId(ship)];
    if (!hold || !ship.move) {
      continue;
    }
    steps.push({
      kind: "move",
      origin: ship.origin,
      unit: ship.unit,
      damaged: ship.damaged,
      gravity_drive: ship.move.gravity_drive,
      ionian: ship.move.ionian,
    });
    for (const [pool, count] of Object.entries(hold)) {
      const from = facts.cargo[Number(pool)];
      for (let loaded = 0; from && loaded < count; loaded++) {
        steps.push({
          kind: "load",
          origin: ship.origin,
          pickup_system: from.system,
          unit: from.unit,
          source: from.source,
          damaged: from.damaged,
          galvanized: from.galvanized,
        });
      }
    }
    if (ship.capacity > 0) {
      steps.push({ kind: "done_loading" });
    }
  }
  steps.push({ kind: "done_moving" });
  return steps;
}

/**
 * The steps that a stopped plan did not reach, staged again on the facts of now. A step that
 * no longer fits is left out: the player sees what is staged before it is sent again.
 */
export function draftOf(facts: MovementFacts, steps: MovementStep[]): MovementDraft {
  let draft: MovementDraft = {};
  let open: string | null = null;
  for (const step of steps) {
    if (step.kind === "move") {
      const ship = facts.ships.find(
        (item) =>
          !(shipId(item) in draft) &&
          item.origin === step.origin &&
          item.unit === step.unit &&
          item.damaged === step.damaged &&
          canMove(facts, draft, item),
      );
      open = ship ? shipId(ship) : null;
      draft = open ? setShip(facts, draft, open, true) : draft;
    } else if (step.kind === "load" && open) {
      const pool = facts.cargo.findIndex(
        (item) =>
          item.system === step.pickup_system &&
          item.source === step.source &&
          item.unit === step.unit &&
          item.damaged === step.damaged &&
          item.galvanized === step.galvanized,
      );
      if (pool >= 0 && shipOf(facts, open)) {
        draft = setLoad(facts, draft, open, pool, (draft[open]?.[pool] ?? 0) + 1);
      }
    }
  }
  return draft;
}

const flag = (option: ChoiceOption, key: string) => option.payload[key] === true;

/** Whether an offered option is what a step asks for. Compare `MovementStep::matches_option`. */
export function matches(step: MovementStep, option: ChoiceOption): boolean {
  const { payload } = option;
  switch (step.kind) {
    case "move":
      return (
        option.kind === "move" &&
        payload.origin === step.origin &&
        payload.unit === step.unit &&
        flag(option, "damaged") === step.damaged &&
        flag(option, "gravity_drive") === step.gravity_drive &&
        flag(option, "ionian") === step.ionian
      );
    case "load":
      return (
        option.kind === "load" &&
        payload.system === step.origin &&
        payload.pickup_system === step.pickup_system &&
        payload.unit === step.unit &&
        (payload.source ?? null) === step.source &&
        flag(option, "damaged") === step.damaged &&
        flag(option, "galvanized") === step.galvanized
      );
    case "done_loading":
      return option.id === "done_loading";
    case "done_moving":
      return option.id === "done_moving";
  }
}

const describe = (step: MovementStep) =>
  step.kind === "move"
    ? `move ${step.unit} from ${step.origin}`
    : step.kind === "load"
      ? `load ${step.unit} at ${step.pickup_system}`
      : step.kind === "done_loading"
        ? "close the hold"
        : "finish the movement";

export type PlanAnswer =
  /** Answer the choice with this option. `next` is the first step that is still to do. */
  | { kind: "answer"; index: number; next: number }
  /** Every step is done: the choice is not of the plan. */
  | { kind: "done" }
  /** The game asks something else first (a reaction window, another seat). */
  | { kind: "interrupted"; reason: string }
  /** The game does not offer what the step asks for. */
  | { kind: "mismatch"; reason: string };

/**
 * What a plan answers to a choice of the game, from step `next` on. The three rules of the
 * server's batch (`PrivateDecider` in `batch.rs`): a hold that closed itself needs no
 * `done_loading`; a hold that the plan does not load is declined; any other question stops the plan.
 */
export function planAnswer(
  steps: MovementStep[],
  next: number,
  choice: Choice,
  actor: string,
): PlanAnswer {
  const subtype = choice.context?.subtype;
  const own = choice.player === actor;
  const pick = (step: MovementStep, at: number): PlanAnswer => {
    const found = choice.options.flatMap((option, index) => (matches(step, option) ? [index] : []));
    return found.length === 1
      ? { kind: "answer", index: found[0], next: at }
      : {
          kind: "mismatch",
          reason: `The game does not offer to ${describe(step)}${found.length ? " in one way only" : ""}.`,
        };
  };
  if (own && subtype === "movement_step") {
    while (steps[next]?.kind === "done_loading") {
      next += 1;
    }
  }
  const step = steps[next];
  if (!step) {
    return { kind: "done" };
  }
  if (own && subtype === "load_cargo" && step.kind !== "load" && step.kind !== "done_loading") {
    // A hold that the plan does not load.
    return pick({ kind: "done_loading" }, next);
  }
  const wanted =
    step.kind === "move" || step.kind === "done_moving" ? "movement_step" : "load_cargo";
  if (!own || subtype !== wanted) {
    return { kind: "interrupted", reason: "The game asks for another decision first." };
  }
  return pick(step, next + 1);
}
