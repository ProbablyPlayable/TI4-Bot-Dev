// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { UnitPickEntry } from "./UnitPickEntry.ts";

/**
 * What a unit question of [`pick_detailed`] says of its options (Upgrade, Refit Troops, Scuttle,
 * Lucky Shot): its one field is the top-level `units` key of the details, written with
 * [`Choice::hinted_fields`] (display only).
 */
export type UnitPickHints = { 
/**
 * Each unit option by option id.
 */
units: { [key in string]: UnitPickEntry }, };
