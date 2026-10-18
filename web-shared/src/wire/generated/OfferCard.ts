// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Display only: the header of an offer card ([`Choice::offered`]): what it is, its kind, when
 * it applies and the printed or summarised effect.
 */
export type OfferCard = { 
/**
 * What is offered: a card's name or a summary of the question.
 */
title: string, 
/**
 * Its kind: `commander`, `faction ability`, `bombardment`, ...
 */
tag: string, 
/**
 * When it applies (the printed ability window); null when the card names none.
 */
window: string | null, 
/**
 * The printed or summarised effect; null when there is none.
 */
text: string | null, };
