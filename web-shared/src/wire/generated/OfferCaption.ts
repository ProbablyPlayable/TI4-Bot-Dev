// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Display only: the button caption of one option of an offer card ([`Choice::offered`]).
 */
export type OfferCaption = { 
/**
 * The caption.
 */
label: string, 
/**
 * What the answer does, under the caption; null when nothing is said.
 */
hint: string | null, 
/**
 * The other seat whose unit the option is about ([`offer_caption_for_seat`]): the client
 * adds its name beside the hint. Absent for every other option.
 */
seat?: string, };
