// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Display / decider view only, on the planet question of a vote (`details.tally` and
 * `details.votes_so_far`, written by [`Choice::hinted_fields`]): the ledger before this seat's
 * votes, in the outcome order of the cast question, and the votes the seat has cast so far.
 */
export type VoteTallyHints = { 
/**
 * Each outcome with the votes it holds.
 */
tally: Array<[string, number]>, votes_so_far: number, };
