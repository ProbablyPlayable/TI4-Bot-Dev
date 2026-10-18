// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PhraseHints } from "./PhraseHints.ts";
import type { PlayerId } from "./PlayerId.ts";

/**
 * What Lie in Wait's "take which action card" question says: its fields are top-level keys of
 * the details, written with [`Choice::hinted_fields`] (display only).
 */
export type LieInWaitHints = { 
/**
 * The seat whose hand the card is taken from.
 */
from: PlayerId, 
/**
 * The wording of the options (`details.phrases`, see [`crate::phrases::PHRASES_KEY`]).
 */
phrases: PhraseHints, };
