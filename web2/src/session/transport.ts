import type { SessionUpdate } from "./wire";

/** What a transport tells its listeners: the game as the viewer is shown it, or why it stopped. */
export type TransportEvent =
  | { kind: "update"; update: SessionUpdate }
  /** The game cannot go on. The text names the cause. */
  | { kind: "error"; message: string };

/**
 * Where the game runs. The wasm engine in this page implements it now; the websocket to the
 * server will later, with `StateUpdateMsg` as the update and `SubmitChoice` as the answer.
 */
export interface Transport {
  /** A new listener is told the latest event at once, if there is one. */
  subscribe(listener: (event: TransportEvent) => void): () => void;
  /** Answers the pending choice that has this nonce. Any other nonce is ignored. */
  submitChoice(nonce: string, optionId: string): void;
  /** Ends the game on this side. */
  close(): void;
}
