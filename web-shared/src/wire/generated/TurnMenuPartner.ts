// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Another seat in the turn menu (display only, in [`TurnMenuHints::partners`]).
 */
export type TurnMenuPartner = { 
/**
 * The seat.
 */
seat: string, 
/**
 * Its faction.
 */
faction: string, 
/**
 * Whether a transaction with it can be opened now.
 */
available: boolean, 
/**
 * Whether the two are neighbours (in contact for a transaction).
 */
in_contact: boolean, 
/**
 * Why no transaction can be opened, or null when one can.
 */
reason: string | null, 
/**
 * Its trade goods.
 */
trade_goods: number, 
/**
 * Its commodities.
 */
commodities: number, 
/**
 * The promissory notes it holds.
 */
promissory_notes: number, };
