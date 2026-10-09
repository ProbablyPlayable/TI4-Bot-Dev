// The engine in this page: `crates/ti4-wasm`, built by `scripts/build-wasm.sh`.
import type { Transport, TransportEvent } from "./transport";
import type { SessionUpdate } from "./wire";

export interface LocalGame {
  seed: number;
  /** 3 to 8. */
  players: number;
  /** Bit 0 is the first seat. A seat whose bit is set is played here; the others decide at random. */
  humans: number;
}

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

/**
 * Plays one game. `wasmUrl` is the address of `ti4.wasm`.
 * The first update comes when the first seat of this page is asked.
 */
export function createWasmTransport(wasmUrl: string, game: LocalGame): Transport {
  const listeners = new Set<(event: TransportEvent) => void>();
  let latest: TransportEvent | null = null;
  /** The pending choice: its nonce, its option ids in order, and how to answer the engine. */
  let pending: { nonce: string; options: string[]; answer: (index: number) => void } | null = null;
  let closed = false;

  const tell = (event: TransportEvent) => {
    latest = event;
    for (const listener of listeners) {
      listener(event);
    }
  };

  const run = async () => {
    const jspi = WebAssembly as unknown as Partial<Jspi>;
    if (!jspi.Suspending || !jspi.promising) {
      throw new Error(
        "This browser has no WebAssembly JSPI, which local play needs. Chrome 137 or later has it.",
      );
    }
    let exports!: Exports;
    const text = (pointer: number, length: number) =>
      new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, length));
    const readUpdate = (): SessionUpdate | null => {
      const length = exports.ti4_update_len();
      return length ? JSON.parse(text(exports.ti4_update_ptr(), length)) : null;
    };
    const ask = new jspi.Suspending(() => {
      const update = readUpdate();
      if (closed || !update?.pending_choice) {
        return Promise.resolve(LEAVE);
      }
      const { nonce, choice } = update.pending_choice;
      return new Promise<number>((answer) => {
        pending = { nonce, options: choice.options.map((option) => option.id), answer };
        tell({ kind: "update", update });
      });
    });
    const response = await fetch(wasmUrl);
    if (!response.ok) {
      throw new Error(
        `The engine was not found (${response.status} for ${wasmUrl}). Build it with web2/scripts/build-wasm.sh.`,
      );
    }
    const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {
      host: { ask },
    });
    exports = instance.exports as unknown as Exports;
    // A status of 0 or more is the length of a result; below 0, the negated length of an error.
    const status = await jspi.promising(exports.ti4_play)(game.seed, game.players, game.humans);
    const result = text(exports.ti4_response_ptr(), Math.abs(status));
    if (status < 0) {
      throw new Error(result);
    }
    const last = readUpdate();
    if (last && !closed) {
      tell({ kind: "update", update: last });
    }
    const stopped: string | null = JSON.parse(result).stopped;
    if (stopped && !closed) {
      throw new Error(stopped);
    }
  };

  run().catch((error: unknown) => {
    pending = null;
    tell({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  });

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
      answer(index);
    },
    close() {
      closed = true;
      pending?.answer(LEAVE);
      pending = null;
    },
  };
}
