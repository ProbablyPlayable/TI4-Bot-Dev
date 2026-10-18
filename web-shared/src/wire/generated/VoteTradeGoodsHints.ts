// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Display only, on the question to spend trade goods for votes (Hacan commander, Executive Order's
 * spender), written by [`Choice::hinted_fields`] next to `details.kind` = `vote_trade_goods`.
 */
export type VoteTradeGoodsHints = { 
/**
 * The outcome the votes go to.
 */
outcome: string, 
/**
 * The votes cast for it so far.
 */
votes: number, 
/**
 * The trade goods the seat may spend.
 */
goods: number, 
/**
 * The votes each trade good adds: 2 with the Hacan commander, 1 for the spender.
 */
votes_per_good: number, };
