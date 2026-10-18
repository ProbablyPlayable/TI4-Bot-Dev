// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { OfferFactValue } from "./OfferFactValue.ts";

/**
 * Display only: one labelled fact of an offer card ([`Choice::offered`]); its shape says how
 * the client shows the value.
 */
export type OfferFact = { 
/**
 * What the fact is.
 */
label: string, 
/**
 * The unit type.
 */
unit: string, } | { 
/**
 * What the fact is.
 */
label: string, 
/**
 * The planet.
 */
planet: string, 
/**
 * Its system.
 */
system: string, } | { 
/**
 * What the fact is.
 */
label: string, 
/**
 * The seat (empty when nobody).
 */
seat: string, } | { 
/**
 * What the fact is.
 */
label: string, 
/**
 * The technology.
 */
technology: string, } | { 
/**
 * What the fact is.
 */
label: string, 
/**
 * The number now.
 */
from: number, 
/**
 * The number after the answer.
 */
to: number, 
/**
 * Its maximum; null when it has none.
 */
of: number | null, } | { 
/**
 * What the fact is.
 */
label: string, 
/**
 * The value.
 */
value: OfferFactValue, };
