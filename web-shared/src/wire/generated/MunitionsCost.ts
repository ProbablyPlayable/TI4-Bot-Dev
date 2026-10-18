// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * The cost of Munitions Reserves against the trade goods held (display only, `details.cost`
 * inside [`MunitionsOfferHints`]).
 */
export type MunitionsCost = { 
/**
 * The trade goods spent ([`MUNITIONS_COST`]).
 */
trade_goods: number, 
/**
 * The trade goods the seat can spend now.
 */
have: number, };
