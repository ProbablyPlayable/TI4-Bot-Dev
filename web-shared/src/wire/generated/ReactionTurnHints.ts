// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PlayerId } from "./PlayerId.ts";

/**
 * Whose turn a reaction window of the action phase is in, for a seat that asked to be offered
 * a reaction on its own turns only (`ti4_host::view::reaction_modes`): its field is a top-level
 * key of the details, written with [`Choice::hinted_fields`] (display only). A window outside
 * the action phase has none.
 */
export type ReactionTurnHints = { 
/**
 * The active player of the action phase.
 */
active: PlayerId, };
