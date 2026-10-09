// The engine in this page: `crates/ti4-wasm`, built by `scripts/build-wasm.sh`.
import type { LocalGame } from "./savedGame";
import type { Transport, TransportEvent } from "./transport";
import type { SessionUpdate } from "./wire";

interface Exports {
  memory: WebAssembly.Memory;
  ti4_play(seed: number, players: number, humans: number): number;
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
  let latest: TransportEvent | null = null;
  /** The pending choice: its nonce, its option ids in order, and how to answer the engine. */
  let pending: { nonce: string; options: string[]; answer: (index: number) => void } | null = null;
  /** The number of the run that is the game. An undo starts a new run; the old one leaves. */
  let current = 0;

  const tell = (event: TransportEvent) => {
    latest = event;
    for (const listener of listeners) {
      listener(event);
    }
  };

  const run = async (id: number) => {
    const jspi = WebAssembly as unknown as Jspi;
    const script = [...answers];
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
        if (performance.now() - shown > REPLAY_SLICE_MS) {
          tell({ kind: "replaying", done: replayed, total: script.length });
          await breathe();
          shown = performance.now();
        }
        return index;
      }
      return new Promise<number>((answer) => {
        pending = { nonce, options, answer };
        tell({ kind: "update", update, canUndo: answers.length > 0 });
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
      const { answer } = pending;
      pending = null;
      answers.push(optionId);
      play.onAnswers?.(answers);
      answer(index);
    },
    undo() {
      if (answers.length === 0) {
        return;
      }
      answers.pop();
      play.onAnswers?.(answers);
      leave();
      start();
    },
    close() {
      leave();
      listeners.clear();
    },
  };
}
