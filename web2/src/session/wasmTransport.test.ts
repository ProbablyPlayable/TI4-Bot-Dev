import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { setLoad, setShip } from "./movementDraft";
import { type MovementStep, stepsOf } from "./movementPlan";
import type { TransportEvent } from "./transport";
import { type Engine, createWasmTransport } from "./wasmTransport";
import type { MovementFacts, SessionUpdate } from "./wire";

// The real engine, built by `scripts/build-wasm.sh` (it is not in the repository).
const WASM = fileURLToPath(new URL("./ti4.wasm", import.meta.url));
const built = existsSync(WASM);

type Update = Extract<TransportEvent, { kind: "update" }>;

/** A game of seed 3 with seat a on this side, and the updates of it, one after the other. */
async function play() {
  const engine: Engine = { module: await WebAssembly.compile(readFileSync(WASM)), hash: "test" };
  let answers: readonly string[] = [];
  const transport = createWasmTransport(
    engine,
    { seed: 3, players: 8, humans: 1 },
    { onAnswers: (all) => (answers = [...all]) },
  );
  const seen: Update[] = [];
  let wake: (() => void) | null = null;
  transport.subscribe((event) => {
    if (event.kind === "error") {
      throw new Error(event.message);
    }
    if (event.kind === "update") {
      seen.push(event);
      wake?.();
    }
  });
  let read = 0;
  const next = async (): Promise<Update> => {
    while (seen.length <= read) {
      await new Promise<void>((resume) => (wake = resume));
    }
    return seen[read++];
  };
  const nonce = (event: Update) => event.update.pending_choice!.nonce;
  return { transport, next, nonce, answers: () => answers };
}

const shipsIn = (update: SessionUpdate, system: string) =>
  (update.view.board.systems[system]?.units ?? [])
    .filter((unit) => unit.owner === "a")
    .map((unit) => unit.unit_type)
    .sort();
const subtype = (event: Update) => event.update.pending_choice?.choice.context?.subtype;

it.skipIf(!built)(
  "sends a movement as one plan, takes a refused plan back, and undoes a movement whole",
  async () => {
    const { transport, next, nonce, answers } = await play();
    // Seat a takes a tactical action and activates the system next to its home.
    for (const answer of ["pok8imperial", "no", "tactical", "23"]) {
      transport.submitChoice(nonce(await next()), answer);
    }
    const open = await next();
    expect(subtype(open)).toBe("movement_step");
    const facts = open.update.tactical as MovementFacts;
    expect(facts.moved).toBe(0);
    expect(shipsIn(open.update, "23")).toEqual([]);
    const home = shipsIn(open.update, "01");

    // A plan with a step that the game does not offer, after a ship that it does offer.
    let draft = setShip(facts, {}, "01|0", true);
    draft = setLoad(
      facts,
      draft,
      "01|0",
      facts.cargo.findIndex((pool) => pool.unit === "sol_infantry"),
      2,
    );
    draft = setLoad(
      facts,
      draft,
      "01|0",
      facts.cargo.findIndex((pool) => pool.unit === "fighter"),
      1,
    );
    const good = stepsOf(facts, setShip(facts, draft, "01|2", true));
    const dreadnought: MovementStep = {
      kind: "move",
      origin: "01",
      unit: "dreadnought",
      damaged: false,
      gravity_drive: false,
      ionian: false,
    };
    const bad = [...good.slice(0, -1), dreadnought, good.at(-1)!];
    transport.submitPlan(nonce(open), { destination: "23", steps: bad });
    const refused = await next();
    // Nothing of the plan is in the game: the same choice is open, on the same board.
    expect(refused.plan).toEqual({
      destination: "23",
      applied: 0,
      remaining: bad,
      interrupted: false,
      reason: "The game does not offer to move dreadnought from 01.",
    });
    expect(nonce(refused)).toBe(nonce(open));
    expect(answers()).toHaveLength(4);
    expect(shipsIn(refused.update, "23")).toEqual([]);
    expect(shipsIn(refused.update, "01")).toEqual(home);
    expect((refused.update.tactical as MovementFacts).moved).toBe(0);

    // The plan that fits: a carrier with two infantry and a fighter, and the destroyer.
    transport.submitPlan(nonce(refused), { destination: "23", steps: good });
    const after = await next();
    expect(after.plan).toBeUndefined();
    expect(subtype(after)).not.toBe("movement_step");
    expect(subtype(after)).not.toBe("load_cargo");
    expect(shipsIn(after.update, "23")).toEqual([
      "destroyer",
      "fighter",
      "sol_carrier",
      "sol_infantry",
      "sol_infantry",
    ]);
    // move, three loads, the closed hold, move, done: each is an answer of the saved game.
    expect(answers().slice(4)).toEqual([
      "move|01|0",
      "load|0",
      "load|3",
      "load|4",
      "done_loading",
      "move|01|1",
      "done_moving",
    ]);

    // One undo takes the movement back whole.
    expect(after.canUndo).toBe(true);
    transport.undo();
    const again = await next();
    expect(subtype(again)).toBe("movement_step");
    expect(nonce(again)).toBe(nonce(open));
    expect(answers()).toHaveLength(4);
    expect(shipsIn(again.update, "23")).toEqual([]);
    expect(shipsIn(again.update, "01")).toEqual(home);

    // One more undo is one answer: the activation is open again.
    transport.undo();
    expect(subtype(await next())).toBe("activate_system");
    expect(answers()).toHaveLength(3);
    transport.close();
  },
  60_000,
);

it.skipIf(!built)(
  "plays a saved game again, and still undoes its movement whole",
  async () => {
    const first = await play();
    for (const answer of ["pok8imperial", "no", "tactical", "23"]) {
      first.transport.submitChoice(first.nonce(await first.next()), answer);
    }
    const open = await first.next();
    const facts = open.update.tactical as MovementFacts;
    const steps = stepsOf(facts, setShip(facts, setShip(facts, {}, "01|0", true), "01|2", true));
    first.transport.submitPlan(first.nonce(open), { destination: "23", steps });
    await first.next();
    const saved = [...first.answers()];
    first.transport.close();
    // The hold of the carrier was declined, though the plan loads nothing.
    expect(saved.slice(4)).toEqual(["move|01|0", "done_loading", "move|01|1", "done_moving"]);

    // A new visit: the page does not know which answers were one plan.
    const engine: Engine = { module: await WebAssembly.compile(readFileSync(WASM)), hash: "test" };
    let answers: readonly string[] = saved;
    const transport = createWasmTransport(
      engine,
      { seed: 3, players: 8, humans: 1 },
      { answers: saved, onAnswers: (all) => (answers = [...all]) },
    );
    const updates: Update[] = [];
    let wake: (() => void) | null = null;
    transport.subscribe((event) => {
      if (event.kind === "update") {
        updates.push(event);
        wake?.();
      }
    });
    const wait = async (count: number) => {
      while (updates.length < count) {
        await new Promise<void>((resume) => (wake = resume));
      }
      return updates[count - 1];
    };
    const resumed = await wait(1);
    expect(shipsIn(resumed.update, "23")).toEqual(["destroyer", "sol_carrier"]);
    transport.undo();
    const back = await wait(2);
    expect(subtype(back)).toBe("movement_step");
    expect((back.update.tactical as MovementFacts).moved).toBe(0);
    expect(answers).toHaveLength(4);
    transport.close();
  },
  60_000,
);
