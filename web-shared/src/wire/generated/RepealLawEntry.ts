// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * One law of [`RepealLawHints`] (display only): the card as printed, flattened into the
 * entry, and the outcome that passed it.
 */
export type RepealLawEntry = { 
/**
 * The outcome that passed it, null when the state records none.
 */
outcome: string | null, 
/**
 * The agenda's content alias.
 */
id: string, 
/**
 * Its printed name, or the alias when the content has none.
 */
name: string, 
/**
 * Its type (law or directive).
 */
type: string, 
/**
 * What its outcomes elect (e.g. "For/Against", a player, a planet).
 */
target: string, 
/**
 * The first paragraph of its text.
 */
text1: string, 
/**
 * The second paragraph of its text.
 */
text2: string, };
