// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * What a placement question of Manipulate Investments says: its fields are top-level keys of the
 * details, written with [`Choice::hinted_fields`] (display only).
 */
export type ManipulateInvestmentsHints = { 
/**
 * Which trade good this placement is (1-based).
 */
step: number, 
/**
 * The trade goods placed in all.
 */
of: number, 
/**
 * The different strategy cards still owed a trade good.
 */
distinct_owed: number, };
