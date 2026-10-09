import { useEffect, useState } from "react";
import { GameShell } from "../game/shell/GameShell";
import type { Transport } from "../session/transport";
import { useLiveSession } from "../session/useLiveSession";
import { type LocalGame, createWasmTransport } from "../session/wasmTransport";

// Not an import: the file is built by scripts/build-wasm.sh and is not in the repository. Without
// it the rest of web2 still builds, and this page says how to build it.
const wasmUrl = new URL("../session/ti4.wasm", import.meta.url).href;

/**
 * A game of the engine in this page. `?local=3&players=8&humans=1`: the seed, the number of
 * seats, and which seats are played here (bit 0 is seat A; 255 is hotseat for eight).
 */
export function LocalApp({ game }: { game: LocalGame }) {
  // Made in an effect, not in a memo: the game is closed when the page lets go of it, and React
  // may do that and mount again (StrictMode). Each mount gets a game of its own.
  const [transport, setTransport] = useState<Transport | null>(null);
  useEffect(() => {
    const made = createWasmTransport(wasmUrl, game);
    setTransport(made);
    return () => made.close();
  }, [game]);
  const { session, error } = useLiveSession(transport);
  if (!session) {
    return (
      <p role="status" className={error ? "p-5 text-red" : "p-5 text-muted"}>
        {error ?? "Starting the game…"}
      </p>
    );
  }
  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
      <GameShell session={session} />
    </div>
  );
}

/** The game that the address asks for, or null when it asks for none. */
export function localGame(params: URLSearchParams): LocalGame | null {
  if (!params.has("local")) {
    return null;
  }
  const number = (name: string, otherwise: number) => {
    const value = Number(params.get(name) || otherwise);
    return Number.isInteger(value) && value >= 0 ? value : otherwise;
  };
  return { seed: number("local", 3), players: number("players", 8), humans: number("humans", 1) };
}
