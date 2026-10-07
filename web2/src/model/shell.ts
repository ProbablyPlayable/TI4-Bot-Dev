import type { ActionView } from "./action";
import type { BoardView } from "./board";
import type { Rich, SeatId, SeatView } from "./core";
import type { Intent } from "./intents";

export type Workspace = "live" | "draft" | "history";

export interface ToolbarView {
  round: number;
  phase: string;
  /** "Tactical action complete", or what the game waits for. */
  status: string;
  workspace: Workspace;
  /** False when the viewer may not draft, with the reason. */
  draftLocked: string | null;
  past: { label: string } | null;
  /** Controls of the private draft. Null outside the draft. */
  draft: { canUndo: boolean; canRedo: boolean; canApply: boolean; applyHint: string } | null;
}

/** One row of the player table. Compare `PlayerView`. */
export interface PlayerRowView {
  seat: SeatId;
  isMe: boolean;
  turn: "now" | "next" | null;
  speaker: boolean;
  passed: boolean;
  victoryPoints: number;
  /** One card for each player with five or more players, two with four or fewer. In initiative order. */
  strategyCards: { number: number; name: string; used: boolean }[];
  resources: [ready: number, total: number];
  influence: [ready: number, total: number];
  tradeGoods: number;
  commodities: [held: number, limit: number];
  tokens: [tactic: number, fleet: number, strategy: number];
  actionCards: number;
  secrets: [scored: number, held: number];
  planets: number;
  abilities: string[];
  technologies: string[];
  leaders: string;
}

export interface PlayerTableView {
  rows: PlayerRowView[];
  freeCards: { number: number; name: string; tradeGoods: number }[];
}

export interface ListSectionView {
  title: string;
  rows: Rich[];
}

export interface LogEntryView {
  id: string;
  seat: SeatId;
  type: string;
  summary: string;
  stages: { name: string; text: string }[];
  /** The action that is open in Live. */
  current: boolean;
}

export interface ReferenceView {
  objectives: ListSectionView[];
  technology: ListSectionView[];
  cards: ListSectionView[];
  log: { round: number; label: string; entries: LogEntryView[] }[];
}

export interface ApplyView {
  items: string[];
  cost: string;
  note: string;
}

export interface ShellView {
  seats: Record<SeatId, SeatView>;
  /** Colours the frame: a private draft, the live game, or a complete action. */
  accent: "draft" | "live" | "done";
  toolbar: ToolbarView;
  players: PlayerTableView;
  board: BoardView;
  action: ActionView;
  reference: ReferenceView;
  /** What "Apply to Live" will commit. Null when there is nothing to apply. */
  apply: ApplyView | null;
  /** A list row to scroll into view, after the player chose its counterpart on the board. */
  reveal: string | null;
  toast: { id: number; text: string } | null;
  announcement: string;
}

/** The only thing the game shell needs. The mock implements it now; a websocket session will later. */
export interface GameSession {
  view: ShellView;
  dispatch: (intent: Intent) => void;
}
