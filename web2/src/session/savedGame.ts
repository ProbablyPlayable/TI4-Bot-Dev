// A local game as it is kept between two visits: not its state, but what plays it again.
// The engine is deterministic, so the seed and the answers of this page give the same game.

/** Which game the engine sets up. */
export interface LocalGame {
  seed: number;
  /** 3 to 8. */
  players: number;
  /** Bit 0 is the first seat. A seat whose bit is set is played here; the others decide at random. */
  humans: number;
}

export interface SavedGame extends LocalGame {
  format: 1;
  /** SHA-256 of the engine file that played it. Another engine may play the answers differently. */
  engine: string;
  /** The option id of each answer of this page, in order. */
  answers: string[];
}

/** The part of `Storage` that is used, so a test can pass a map. */
export type SaveStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const saveKey = (game: LocalGame): string =>
  `ti4.local.${game.seed}.${game.players}.${game.humans}`;

/** Where the staged movement of the open movement step is kept: it is not an answer yet. */
export const draftKey = (game: LocalGame): string => `${saveKey(game)}.movement`;

/** Where the private draft of a tactical action is kept, with its undo history. */
export const planKey = (game: LocalGame): string => `${saveKey(game)}.draft`;

/** Whether the other seats wait for a step. A setting of the page, not of one game. */
export const STEPPING_KEY = "ti4.local.stepping";

const isCount = (value: unknown): value is number =>
  Number.isInteger(value) && (value as number) >= 0;

/** Reads a saved game from its JSON text. An error says which part is wrong. */
export function parseSavedGame(text: string): SavedGame {
  let value: Partial<Record<keyof SavedGame, unknown>>;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `The saved game is not JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new Error("The saved game is not a JSON object.");
  }
  if (value.format !== 1) {
    throw new Error(
      `The saved game has format ${JSON.stringify(value.format)}; this page reads format 1.`,
    );
  }
  for (const field of ["seed", "players", "humans"] as const) {
    if (!isCount(value[field])) {
      throw new Error(`The saved game has no whole number in "${field}".`);
    }
  }
  if (typeof value.engine !== "string") {
    throw new Error('The saved game has no text in "engine".');
  }
  const { answers } = value;
  if (!Array.isArray(answers) || !answers.every((answer) => typeof answer === "string")) {
    throw new Error('The saved game has no list of option ids in "answers".');
  }
  return {
    format: 1,
    engine: value.engine,
    seed: value.seed as number,
    players: value.players as number,
    humans: value.humans as number,
    answers,
  };
}

/** The saved game of this seed, seats and human seats, or null when there is none. */
export function loadSavedGame(storage: SaveStorage, game: LocalGame): SavedGame | null {
  const text = storage.getItem(saveKey(game));
  return text === null ? null : parseSavedGame(text);
}

/** Writes the whole game. It is a few KiB: one short id for each answer. */
export function storeSavedGame(storage: SaveStorage, save: SavedGame): void {
  storage.setItem(saveKey(save), JSON.stringify(save));
}

export function clearSavedGame(storage: SaveStorage, game: LocalGame): void {
  storage.removeItem(saveKey(game));
  storage.removeItem(draftKey(game));
  storage.removeItem(planKey(game));
}
