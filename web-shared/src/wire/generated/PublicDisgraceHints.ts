// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PlayerId } from "./PlayerId.ts";
import type { StrategyCardId } from "./StrategyCardId.ts";

/**
 * What Public Disgrace's "choose a different strategy card" question says: its fields are
 * top-level keys of the details, written with [`Choice::hinted_fields`] (display only).
 */
export type PublicDisgraceHints = { 
/**
 * The strategy card that was taken away.
 */
first: StrategyCardId, 
/**
 * The seat that played Public Disgrace.
 */
played_by: PlayerId, };
