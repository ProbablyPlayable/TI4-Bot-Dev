// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * A strategy card the seat holds (display only, in [`TurnMenuHints::strategy_cards`]).
 */
export type TurnMenuStrategyCard = { 
/**
 * The card's id.
 */
card: string, 
/**
 * Whether its strategic action is spent.
 */
used: boolean, 
/**
 * The option that plays its strategic action, or null when none does now.
 */
option: string | null, };
