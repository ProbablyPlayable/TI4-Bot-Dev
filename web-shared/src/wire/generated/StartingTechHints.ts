// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { FactionId } from "./FactionId.ts";
import type { StartingTechRule } from "./StartingTechRule.ts";
import type { TechnologyId } from "./TechnologyId.ts";

/**
 * Display only: the facts of a starting-technology pick ([`choice`]), written as top-level
 * keys of its details with [`Choice::hinted_fields`].
 */
export type StartingTechHints = { 
/**
 * Which pick of the seat this is, counted from 1.
 */
pick: number, 
/**
 * How many picks the seat makes in all.
 */
of: number, 
/**
 * The rule that offers the technologies.
 */
rule: StartingTechRule, 
/**
 * The faction of the seat that chooses.
 */
faction: FactionId, 
/**
 * The technologies the seat holds already.
 */
held: Array<TechnologyId>, };
