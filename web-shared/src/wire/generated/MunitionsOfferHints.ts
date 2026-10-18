// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { FactionAbilityCard } from "./FactionAbilityCard.ts";
import type { MunitionsCost } from "./MunitionsCost.ts";

/**
 * The facts of a Munitions Reserves question, before or after the roll (display only, top-level
 * keys of the details, written with [`crate::choice::Choice::hinted_fields`]): the printed
 * ability and its cost against the trade goods held.
 */
export type MunitionsOfferHints = { 
/**
 * The printed Munitions Reserves.
 */
ability: FactionAbilityCard, 
/**
 * The trade goods it costs and those held.
 */
cost: MunitionsCost, };
