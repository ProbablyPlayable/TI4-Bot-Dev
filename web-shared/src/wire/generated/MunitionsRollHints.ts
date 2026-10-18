// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * The staged roll of a Munitions Reserves question asked after the fleet rolled (rules version
 * 2; display only, top-level keys of the details, written with
 * [`crate::choice::Choice::hinted_fields`] next to [`MunitionsOfferHints`]).
 */
export type MunitionsRollHints = { 
/**
 * Every staged die, as [`crate::combat::staged_dice_view`] shows it (the view the combat
 * reroll questions share).
 */
dice: Array<Record<string, unknown>>, 
/**
 * How many of those dice miss.
 */
misses: number, };
