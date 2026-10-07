import type { PlanetId, SystemId, UnitType } from "./core";

/**
 * Everything a player can ask for. The data source decides what an intent does: the mock engine
 * today, `submit_choice` and the planning messages of the wire protocol later.
 */
export type Intent =
  // Workspaces
  | { type: "workspace"; mode: "live" | "draft" | "history" }
  | { type: "closeHistory" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "startOver" }
  | { type: "discardDraft" }
  /** Asks for the confirmation dialog. The shell answers this one itself. */
  | { type: "openApply" }
  | { type: "confirmApply" }
  // Steps
  | { type: "selectStep"; step: number }
  | { type: "returnToCurrent" }
  | { type: "returnToEdit" }
  | { type: "editStep"; step: number }
  | { type: "cancelEdit" }
  | { type: "commitEdit" }
  // Staged values of the open step
  | { type: "setCount"; key: string; value: number }
  | { type: "removeLine"; key: string }
  | { type: "setPlacement"; unit: UnitType; place: string }
  | { type: "chooseRoute"; line: string; index: number }
  | { type: "setPayment"; source: string; on: boolean }
  // Board
  | { type: "inspectSystem"; system: SystemId }
  | { type: "closeInspector" }
  | { type: "expandOrigin"; system: SystemId }
  | { type: "findSystem"; query: string }
  | { type: "togglePlanet"; planet: PlanetId }
  // Battles
  | {
      type: "battle";
      action:
        | "roll"
        | "announceRetreat"
        | "assignHits"
        | "resetHits"
        | "passReaction"
        | "playReaction"
        | "retreat";
    }
  | { type: "playCard"; card: string }
  | { type: "stageHit"; unit: UnitType; kind: "sustain" | "destroy" | "destroy-damaged" }
  | { type: "pickRetreat"; destination: string }
  // Other actions
  | { type: "pickAction"; action: "tactical" | "strategic" | "component"; system?: SystemId }
  | { type: "backToPicker" }
  | { type: "flow"; action: "resolve" | "ready" | "change" | "play" }
  | { type: "flowCount"; key: string; value: number }
  | { type: "flowTarget"; planet: PlanetId }
  | { type: "inspectLogEntry"; id: string }
  /** Lets another seat act. Only the demo offers this. */
  | { type: "simulate" };
