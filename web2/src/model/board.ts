import type { PaymentView } from "./action";
import type { Force, PlanetId, SeatId, SystemId } from "./core";

export type Anomaly = "asteroid" | "supernova" | "nebula" | "rift";
export type TechColor = "B" | "G" | "Y" | "R";

/** One planet on a tile. Compare `PlanetMetaView` + `PlanetView`. */
export interface PlanetMarkView {
  id: PlanetId;
  name: string;
  resources: number;
  influence: number;
  owner: SeatId | null;
  tech: TechColor | null;
  groundForces: number;
  planetaryShield: boolean;
}

/** One system on the board. Compare `BoardTileView` + `SystemView`. */
export interface TileView {
  id: SystemId;
  /** Not drawn on the board. The inspector and assistive technology use it. */
  name: string;
  q: number;
  r: number;
  home: SeatId | null;
  anomaly: Anomaly | null;
  wormhole: string | null;
  /** The viewer's command token is here. */
  commandToken: boolean;
  /** At most three. */
  planets: PlanetMarkView[];
  /** Who has ships here: one seat, or "contested" when two or more players have ships. */
  control: SeatId | "contested" | null;
  /** Ships in the space area. `strength` is the average number of hits per combat round. */
  fleets: { seat: SeatId; ships: number; strength: number }[];
  /** Cargo that staged ships pick up here. */
  pickedUp: number;
}

export interface RouteView {
  /** Link token id: a row with `rt:<id>` lights this route. */
  id: string;
  path: SystemId[];
  staged: boolean;
}

/**
 * What the open task lets the player choose on the board: planets or systems.
 * It is drawn over any map view. The keys of `values` are the things that can be chosen.
 */
export interface BoardTaskView {
  target: "planet" | "system";
  kind: "pay" | "pick";
  /** False when the choices are only shown, for example a recorded payment. */
  interactive: boolean;
  values: Record<PlanetId | SystemId, number>;
  chosen: Record<PlanetId | SystemId, boolean>;
  verb: string;
  unit: string;
  /** A payment that is open: the board has its state and its controls, where the player chooses. */
  payment?: PaymentView;
}

export interface InspectorRowView {
  /** A seat row shows a fleet; a planet row shows a planet. */
  seat?: SeatId;
  planet?: { name: string; resources: number; influence: number; owner: SeatId | null };
  label?: string;
  text?: string;
  force?: Force;
  notes?: { text: string; tone: "muted" | "planned" }[];
}

export interface InspectorView {
  system: SystemId;
  title: string;
  facts: string;
  notes: string[];
  rows: InspectorRowView[];
  /** Set when the player may start a tactical action here. */
  activate: "allowed" | "token" | null;
}

export interface BoardView {
  tiles: TileView[];
  wormholes: [SystemId, SystemId][];
  routes: RouteView[];
  activeSystem: SystemId | null;
  inspected: SystemId | null;
  /** A click on a system chooses the activation target. */
  targeting: boolean;
  task: BoardTaskView | null;
  inspector: InspectorView | null;
  /** The systems of the open task, for "Fit task". */
  taskSystems: SystemId[];
  /** Changes when the board must be framed again, for example for a new action. */
  fitKey: string;
  latestResult: string;
}
