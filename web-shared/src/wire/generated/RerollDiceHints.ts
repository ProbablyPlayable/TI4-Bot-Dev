// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { StagedDie } from "./StagedDie.ts";

/**
 * The details of a die-by-die reroll question ([`choose_reroll_dice`]; display only, top-level
 * keys of the details, written with [`Choice::hinted_fields`]).
 */
export type RerollDiceHints = { 
/**
 * The whole staged roll, as [`staged_dice_view`] shows it.
 */
dice: Array<StagedDie>, 
/**
 * The position in `dice` of the die this question is about.
 */
current: number, };
