// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PlayerId } from "./PlayerId.ts";

/**
 * The seats of a question whose options are faction names, Politics' speaker question and
 * Trade's question of the other seats: its field is a top-level key of the details,
 * `details.seats`, written with [`Choice::hinted_fields`], so that a client or a bot can map
 * an option back to its seat (display only).
 */
export type SeatChoiceHints = { 
/**
 * The seat of each option, by the id of the option (the seat's faction name).
 */
seats: { [key in string]: PlayerId }, };
