// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { OfferCaption } from "./OfferCaption.ts";
import type { OfferCard } from "./OfferCard.ts";
import type { OfferFact } from "./OfferFact.ts";

/**
 * Display only: an offer card's details ([`Choice::offered`]), top-level keys beside
 * `kind: "offer"`: the header, the facts and a caption per option id.
 */
export type OfferHints = { 
/**
 * What is asked.
 */
card: OfferCard, 
/**
 * The labelled facts, in order.
 */
facts: Array<OfferFact>, 
/**
 * What each answer does, by option id (options without one have no entry).
 */
captions: { [key in string]: OfferCaption }, };
