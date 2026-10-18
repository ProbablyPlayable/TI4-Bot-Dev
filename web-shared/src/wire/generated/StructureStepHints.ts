// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Where a placement of a structure ability stands in its card's sequence, on the question of
 * the placement: its fields are top-level keys of the details, `details.step`, `details.of`
 * and `details.only_pds`, written with [`Choice::hinted_fields`] (display only).
 */
export type StructureStepHints = { 
/**
 * Which placement of the sequence this is, from 1. Left out for a lone placement.
 */
step?: number, 
/**
 * How many placements the sequence has. Left out for a lone placement.
 */
of?: number, 
/**
 * This placement places only a PDS. Left out when false.
 */
only_pds?: boolean, };
