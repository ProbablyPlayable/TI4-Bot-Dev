// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PlayerId } from "./PlayerId.ts";

/**
 * What the strategy card question of a card that performs another card's ability says (e.g.
 * Overrule's pick): its one field is the top-level `holders` key of the details, written
 * with [`Choice::hinted_fields`] (display only).
 */
export type StrategyCardHoldersHints = { 
/**
 * The seat that holds each card on offer, by card; `null` for a card no seat has chosen.
 */
holders: { [key in string]: PlayerId | null }, };
