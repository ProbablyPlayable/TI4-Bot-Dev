// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * The printed faction ability an offer is about (display only, `details.ability` of the
 * Munitions Reserves questions, inside [`MunitionsOfferHints`]). A text the content lacks is
 * `null`.
 */
export type FactionAbilityCard = { 
/**
 * The ability's printed name.
 */
name: string | null, 
/**
 * When it may be used (the content's `window`).
 */
window: string | null, 
/**
 * What it does in that window (the content's `windowEffect`).
 */
effect: string | null, };
