// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { RepealLawEntry } from "./RepealLawEntry.ts";

/**
 * What the "repeal which law" question says: its one field is the top-level `laws` key of the
 * details, written with [`Choice::hinted_fields`] (display only).
 */
export type RepealLawHints = { 
/**
 * Each law in play as printed with the outcome that passed it, by law.
 */
laws: { [key in string]: RepealLawEntry }, };
