// The engine in this page: `crates/ti4-wasm`, built by `scripts/build-wasm.sh`.
import type { LocalGame } from "./savedGame";
import { type MovementStep, planAnswer, stepOf } from "./movementPlan";
import type { PlanStopped, Transport, TransportEvent } from "./transport";
import type { ChoiceOption, SessionUpdate } from "./wire";

interface Exports {
  memory: WebAssembly.Memory;
  ti4_play(seed: number, players: number, humans: number): number;
  ti4_can_undo(): number;
  ti4_response_ptr(): number;
  ti4_update_ptr(): number;
  ti4_update_len(): number;
}

// JSPI: the engine asks for a decision with a blocking call. `Suspending` parks its stack until
// the promise of the answer settles, and `promising` makes the export that runs the game async.
interface Jspi {
  Suspending: new (ask: () => Promise<number>) => WebAssembly.ImportValue;
  promising(
    run: Exports["ti4_play"],
  ): (...args: Parameters<Exports["ti4_play"]>) => Promise<number>;
}

/** Leaves the game: the engine unwinds and `ti4_play` returns. */
const LEAVE = -1;
/** Takes back the answer before the pending choice, when `ti4_can_undo` says the engine can. */
const UNDO = -2;

/** A replay gives the page a turn this often, so it can show how far the replay is. */
const REPLAY_SLICE_MS = 50;

/** The engine file, compiled once. Each game and each undo makes an instance of it. */
export interface Engine {
  module: WebAssembly.Module;
  /** SHA-256 of the file, in hex. A saved game names the engine that played it. */
  hash: string;
}

/** Fetches and compiles `ti4.wasm` from `wasmUrl`. */
export async function loadEngine(wasmUrl: string): Promise<Engine> {
  const jspi = WebAssembly as unknown as Partial<Jspi>;
  if (!jspi.Suspending || !jspi.promising) {
    throw new Error(
      "This browser has no WebAssembly JSPI, which local play needs. Chrome 137 or later has it.",
    );
  }
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(
      `The engine was not found (${response.status} for ${wasmUrl}). Build it with web2/scripts/build-wasm.sh.`,
    );
  }
  const bytes = await response.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    module: await WebAssembly.compile(bytes),
    hash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

export interface LocalPlay {
  /** Answers of an earlier visit. The game is played again with them before the first update. */
  answers?: readonly string[];
  /** Told the whole list after each answer and each undo, to keep it. */
  onAnswers?(answers: readonly string[]): void;
}

/** A turn of the event loop. A timer would be slowed down in a tab that is not shown. */
const breathe = () =>
  new Promise<void>((resume) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resume();
    channel.port2.postMessage(null);
  });

/**
 * Plays one game. The first update comes when the first seat of this page is asked and the
 * answers of `play.answers` are used up.
 */
export function createWasmTransport(
  engine: Engine,
  game: LocalGame,
  play: LocalPlay = {},
): Transport {
  const listeners = new Set<(event: TransportEvent) => void>();
  const answers = [...(play.answers ?? [])];
  /**
   * What each answer of this run chose, as far as the run has given it: an id alone does not say
   * that. Compare `RecordedDecision` of the server. A game that is played again fills it again.
   */
  let recorded: ChoiceOption[] = [];
  let latest: TransportEvent | null = null;
  /** The pending choice: its update, its option ids in order, and how to answer the engine. */
  let pending: {
    nonce: string;
    update: SessionUpdate;
    options: string[];
    answer: (index: number) => void;
    /** The engine has a checkpoint for the answer before this choice. */
    canGoBack: boolean;
  } | null = null;
  /** The plan that is being sent: the choices of the game are answered from its steps. */
  let plan: {
    destination: string;
    steps: MovementStep[];
    next: number;
    actor: string;
    /** How many answers the game had before the plan. */
    start: number;
    /** The game refused a step: the answers of the plan are taken back, down to `start`. */
    refused: string | null;
  } | null = null;
  /** Told with the next update: where the last plan stopped. */
  let planStopped: PlanStopped | null = null;
  /** An undo goes on while the choice that is open again is in the middle of a movement. */
  let undoing = false;
  /** What the undo took back so far, first answer first. Told with the next update. */
  let undone: ChoiceOption[] = [];
  /** The answers of each plan of this visit, as a range of `answers`: an undo takes them back whole. */
  let groups: { start: number; end: number }[] = [];
  /** The number of the run that is the game. An undo starts a new run; the old one leaves. */
  let current = 0;

  const tell = (event: TransportEvent) => {
    latest = event;
    for (const listener of listeners) {
      listener(event);
    }
  };

  /** Shows the player a choice, with what the plan or the undo before it came to. */
  const show = (update: SessionUpdate) => {
    const steps = undone.flatMap((answer) => stepOf(answer) ?? []);
    tell({
      kind: "update",
      update,
      canUndo: answers.length > 0,
      plan: planStopped ?? undefined,
      undone: steps.length ? steps : undefined,
    });
    planStopped = null;
    undone = [];
  };

  const run = async (id: number) => {
    const jspi = WebAssembly as unknown as Jspi;
    const script = [...answers];
    recorded = [];
    let replayed = 0;
    let shown = performance.now();
    let diverged: string | null = null;
    let exports!: Exports;
    const text = (pointer: number, length: number) =>
      new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, length));
    const readUpdate = (): SessionUpdate | null => {
      const length = exports.ti4_update_len();
      return length ? JSON.parse(text(exports.ti4_update_ptr(), length)) : null;
    };
    const ask = new jspi.Suspending(async () => {
      const update = readUpdate();
      if (id !== current || !update?.pending_choice) {
        return LEAVE;
      }
      const { nonce, choice } = update.pending_choice;
      const options = choice.options.map((option) => option.id);
      if (replayed < script.length) {
        const wanted = script[replayed];
        const index = options.indexOf(wanted);
        if (index < 0) {
          diverged =
            `The saved game does not fit this engine: answer ${replayed + 1} of ${script.length} ` +
            `was "${wanted}", but "${choice.prompt}" offers ${options.map((option) => `"${option}"`).join(", ")}. ` +
            "Start a new game.";
          return LEAVE;
        }
        replayed += 1;
        recorded.push(choice.options[index]);
        if (performance.now() - shown > REPLAY_SLICE_MS) {
          tell({ kind: "replaying", done: replayed, total: script.length });
          await breathe();
          shown = performance.now();
        }
        return index;
      }
      const canGoBack = exports.ti4_can_undo() === 1;
      const index = decide(update, canGoBack);
      if (index !== null) {
        return index;
      }
      return new Promise<number>((answer) => {
        pending = { nonce, update, options, answer, canGoBack };
        show(update);
      });
    });
    const instance = await WebAssembly.instantiate(engine.module, { host: { ask } });
    exports = instance.exports as unknown as Exports;
    // A status of 0 or more is the length of a result; below 0, the negated length of an error.
    const status = await jspi.promising(exports.ti4_play)(game.seed, game.players, game.humans);
    if (id !== current) {
      return;
    }
    if (diverged) {
      throw new Error(diverged);
    }
    const result = text(exports.ti4_response_ptr(), Math.abs(status));
    if (status < 0) {
      throw new Error(result);
    }
    const last = readUpdate();
    if (last) {
      tell({ kind: "update", update: last, canUndo: answers.length > 0 });
    }
    const stopped: string | null = JSON.parse(result).stopped;
    if (stopped) {
      throw new Error(stopped);
    }
  };

  const start = () => {
    const id = current;
    if (answers.length > 0) {
      tell({ kind: "replaying", done: 0, total: answers.length });
    }
    run(id).catch((error: unknown) => {
      if (id === current) {
        pending = null;
        tell({ kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
    });
  };
  /**
   * Takes back the answer before the open choice: the engine asks that choice again, from a
   * checkpoint when it has one, or else the game is played again without the answer.
   */
  const back = (canGoBack: boolean): number => {
    /** The answers from `length` on leave, and an undo keeps what they chose. */
    const drop = (length: number) => {
      answers.length = length;
      const gone = recorded.splice(length);
      if (undoing) {
        undone = [...gone, ...undone];
      }
      play.onAnswers?.(answers);
    };
    if (canGoBack) {
      drop(answers.length - 1);
      return UNDO;
    }
    // A game that is played again costs the same for one answer and for many: the answers of a
    // plan go at once.
    const group = groups.findLast(
      (item) => item.start < answers.length && answers.length <= item.end,
    );
    drop(group ? group.start : answers.length - 1);
    groups = groups.filter((item) => item.start < answers.length);
    current += 1;
    start();
    return LEAVE;
  };
  /** A choice in the middle of a movement: a ship has moved, or a hold is open. */
  const insideMovement = (update: SessionUpdate) => {
    const subtype = update.pending_choice?.choice.context?.subtype;
    return (
      subtype === "load_cargo" ||
      (subtype === "movement_step" &&
        update.tactical?.kind === "movement" &&
        update.tactical.moved > 0)
    );
  };
  /**
   * The answer to a choice that needs none from the player: the next step of the plan, or one
   * more step back. Null when the player is asked.
   */
  const decide = (update: SessionUpdate, canGoBack: boolean): number | null => {
    const choice = update.pending_choice!.choice;
    if (plan) {
      const sent = plan;
      const result: ReturnType<typeof planAnswer> = sent.refused
        ? { kind: "mismatch", reason: sent.refused }
        : planAnswer(sent.steps, sent.next, choice, sent.actor);
      if (result.kind === "answer") {
        sent.next = result.next;
        answers.push(choice.options[result.index].id);
        recorded.push(choice.options[result.index]);
        play.onAnswers?.(answers);
        return result.index;
      }
      if (result.kind === "mismatch") {
        // All or nothing: the answers of the plan are taken back before the player is asked.
        if (!sent.refused) {
          sent.refused = result.reason;
          groups.push({ start: sent.start, end: Number.POSITIVE_INFINITY });
        }
        if (answers.length > sent.start) {
          return back(canGoBack);
        }
        groups = groups.filter((item) => item.end !== Number.POSITIVE_INFINITY);
        planStopped = {
          destination: sent.destination,
          applied: 0,
          remaining: sent.steps,
          interrupted: false,
          reason: result.reason,
        };
      } else if (result.kind === "interrupted") {
        planStopped = {
          destination: sent.destination,
          applied: sent.next,
          remaining: sent.steps.slice(sent.next),
          interrupted: true,
          reason: result.reason,
        };
      }
      if (answers.length > sent.start) {
        groups.push({ start: sent.start, end: answers.length });
      }
      plan = null;
    }
    if (undoing) {
      if (answers.length > 0 && insideMovement(update)) {
        return back(canGoBack);
      }
      undoing = false;
    }
    return null;
  };
  /** The run that is the game now is no longer it. Where it waits for an answer, it leaves. */
  const leave = () => {
    current += 1;
    pending?.answer(LEAVE);
    pending = null;
  };
  start();

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (latest) {
        listener(latest);
      }
      return () => listeners.delete(listener);
    },
    submitChoice(nonce, optionId) {
      if (pending?.nonce !== nonce) {
        return;
      }
      const index = pending.options.indexOf(optionId);
      if (index < 0) {
        return;
      }
      const { answer, update } = pending;
      pending = null;
      answers.push(optionId);
      recorded.push(update.pending_choice!.choice.options[index]);
      play.onAnswers?.(answers);
      answer(index);
    },
    submitPlan(nonce, sent) {
      if (pending?.nonce !== nonce || pending.update.viewer.role !== "player") {
        return;
      }
      plan = {
        destination: sent.destination,
        steps: sent.steps,
        next: 0,
        actor: pending.update.viewer.seat,
        start: answers.length,
        refused: null,
      };
      const { update, answer, canGoBack } = pending;
      const index = decide(update, canGoBack);
      if (index === null) {
        // The first step was refused: nothing was sent, and the same choice is open.
        show(update);
        return;
      }
      pending = null;
      answer(index);
    },
    undo() {
      if (answers.length === 0) {
        return;
      }
      undoing = true;
      undone = [];
      // With no choice open the game is over: it is played again without the answer.
      const { answer = null, canGoBack = false } = pending ?? {};
      pending = null;
      answer?.(back(canGoBack));
      if (!answer) {
        back(false);
      }
    },
    close() {
      leave();
      listeners.clear();
    },
  };
}
