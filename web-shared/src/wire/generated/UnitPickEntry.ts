// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PlayerId } from "./PlayerId.ts";

/**
 * One unit option of a [`UnitPickHints`] (display only).
 */
export type UnitPickEntry = { 
/**
 * The system the unit is in.
 */
system: string, 
/**
 * The planet it stands on; `null` for a unit in the space area.
 */
planet: string | null, 
/**
 * Its unit type.
 */
unit: string, 
/**
 * The seat that owns it.
 */
owner: PlayerId, 
/**
 * Whether it has sustained damage.
 */
damaged: boolean, 
/**
 * Its printed cost.
 */
cost: number, };
