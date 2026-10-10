import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { GameShell } from "../game/shell/GameShell";
import { DemoApp } from "./DemoApp";
import {
  type LocalGame,
  type SavedGame,
  clearSavedGame,
  loadSavedGame,
  parseSavedGame,
  saveKey,
  storeSavedGame,
} from "../session/savedGame";
import type { Transport } from "../session/transport";
import { useLiveSession } from "../session/useLiveSession";
import { type Engine, createWasmTransport, loadEngine } from "../session/wasmTransport";
import { Button } from "../ui";

// Not an import: the file is built by scripts/build-wasm.sh and is not in the repository. Without
// it the rest of web2 still builds, and this page says how to build it.
const wasmUrl = new URL("../session/ti4.wasm", import.meta.url).href;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What the page starts from: the engine, and the saved game of this address if there is one. */
type Start =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; engine: Engine; saved: SavedGame | null };

/**
 * A game of the engine in this page. `?local=3&players=8&humans=1`: the seed, the number of
 * seats, and which seats are played here (bit 0 is seat A). The answers are kept in
 * localStorage, so a reload goes on where the game was.
 */
export function LocalApp({ game }: { game: LocalGame }) {
  const [start, setStart] = useState<Start>({ kind: "loading" });
  /** The saved game was played by another engine, and the player said to play it anyway. */
  const [anyway, setAnyway] = useState(false);
  const [answers, setAnswers] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [transport, setTransport] = useState<Transport | null>(null);

  useEffect(() => {
    let stale = false;
    loadEngine(wasmUrl)
      .then((engine) => ({
        kind: "ready" as const,
        engine,
        saved: loadSavedGame(localStorage, game),
      }))
      .catch((error: unknown) => ({ kind: "failed" as const, message: message(error) }))
      .then((next) => stale || setStart(next));
    return () => {
      stale = true;
    };
  }, [game]);

  const foreign =
    start.kind === "ready" && start.saved !== null && start.saved.engine !== start.engine.hash;
  const waits = foreign && !anyway;

  // Made in an effect, not in a memo: the game is closed when the page lets go of it, and React
  // may do that and mount again (StrictMode). Each mount gets a game of its own.
  useEffect(() => {
    if (start.kind !== "ready" || waits) {
      return;
    }
    const { engine, saved } = start;
    setAnswers(saved?.answers.length ?? 0);
    const made = createWasmTransport(engine, game, {
      answers: saved?.answers,
      onAnswers(list) {
        storeSavedGame(localStorage, {
          format: 1,
          engine: engine.hash,
          ...game,
          answers: [...list],
        });
        setAnswers(list.length);
      },
    });
    setTransport(made);
    return () => {
      made.close();
      setTransport(null);
    };
  }, [start, waits, game]);

  const { session, error, replaying } = useLiveSession(transport);

  const newGame = () => {
    clearSavedGame(localStorage, game);
    setAnyway(false);
    setStart((now) => (now.kind === "ready" ? { ...now, saved: null } : now));
  };
  const exportGame = () => {
    const text = localStorage.getItem(saveKey(game));
    if (text === null) {
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    link.download = `ti4-seed${game.seed}-${answers}answers.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const importGame = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const saved = parseSavedGame(await file.text());
      storeSavedGame(localStorage, saved);
      // The file says which game it is. Its address opens it.
      window.location.search = `?local=${saved.seed}&players=${saved.players}&humans=${saved.humans}`;
    } catch (failure) {
      setImportError(message(failure));
    }
  };
  const file = useRef<HTMLInputElement>(null);

  // The engine did not load: the demo is shown with the reason, so the page is never empty.
  if (start.kind === "failed") {
    return <DemoApp notice={`Local game unavailable. ${start.message}`} />;
  }

  let body: ReactNode;
  if (waits) {
    body = (
      <Notice tone="error">
        The saved game ({start.saved?.answers.length} answers) was played by another build of the
        engine. This build may play the same answers differently.
        <span className="mt-3 flex gap-2">
          <Button onClick={() => setAnyway(true)}>Replay anyway</Button>
          <Button onClick={newGame}>New game</Button>
        </span>
      </Notice>
    );
  } else if (!session) {
    body = (
      <Notice tone={error ? "error" : "quiet"}>
        {error ??
          (replaying
            ? `Playing the saved game again: answer ${replaying.done} of ${replaying.total}…`
            : "Starting the game…")}
      </Notice>
    );
  } else {
    body = <GameShell session={session} other={{ label: "Demo", href: "/?example=live-picker" }} />;
  }

  return (
    // The bar is under the shell, so it has the bottom edge of the screen, not the shell.
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] [--inset-bottom:0px]">
      {body}
      <nav
        aria-label="Local game"
        className="flex items-center gap-2 border-t border-line bg-surface px-3 py-1 pb-[max(4px,env(safe-area-inset-bottom))] text-sm text-muted"
      >
        <span className="mr-auto truncate" role={importError ? "alert" : undefined}>
          {importError ? (
            <span className="text-red">{importError}</span>
          ) : (
            `Local game · seed ${game.seed} · ${game.players} seats · ${answers} answers saved`
          )}
        </span>
        <Button tone="quiet" size="sm" disabled={answers === 0} onClick={newGame}>
          New game
        </Button>
        <Button tone="quiet" size="sm" disabled={answers === 0} onClick={exportGame}>
          Export
        </Button>
        <Button tone="quiet" size="sm" onClick={() => file.current?.click()}>
          Import
        </Button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          aria-label="Saved game file"
          hidden
          onChange={importGame}
        />
      </nav>
    </div>
  );
}

function Notice({ tone, children }: { tone: "quiet" | "error"; children: ReactNode }) {
  return (
    <p role="status" className={tone === "error" ? "p-5 text-red" : "p-5 text-muted"}>
      {children}
    </p>
  );
}

/** The game of the bare address `/`: seed 42, eight seats, and only the first seat is played here. */
export const DEFAULT_GAME: LocalGame = { seed: 42, players: 8, humans: 1 };

/**
 * The game that the address asks for. Without `local`, the bare address gets DEFAULT_GAME, and
 * the demo (`example`) and the gallery have their own addresses, so they get none.
 */
export function localGame(params: URLSearchParams): LocalGame | null {
  if (!params.has("local")) {
    return params.has("example") || params.has("gallery") ? null : DEFAULT_GAME;
  }
  const number = (name: string, otherwise: number) => {
    const value = Number(params.get(name) || otherwise);
    return Number.isInteger(value) && value >= 0 ? value : otherwise;
  };
  return { seed: number("local", 3), players: number("players", 8), humans: number("humans", 1) };
}
