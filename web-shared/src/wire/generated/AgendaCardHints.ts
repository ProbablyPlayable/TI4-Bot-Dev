// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * An agenda card as printed, under [`AGENDA_CARD_KEY`] of the details of a question about that
 * agenda (display only), written with [`Choice::hinted`]. A field the content lacks is empty.
 */
export type AgendaCardHints = { 
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
