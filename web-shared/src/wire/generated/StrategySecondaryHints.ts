// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { PlayerId } from "./PlayerId.ts";
import type { StrategyCardId } from "./StrategyCardId.ts";

/**
 * What a follower's secondary question (`details.kind == "strategy_secondary"`) says of the
 * strategic action: its fields are top-level keys of the details, written with
 * [`Choice::hinted_fields`] (display only).
 */
export type StrategySecondaryHints = { 
/**
 * The strategy card whose secondary is asked.
 */
card: StrategyCardId, 
/**
 * The seat that played the card (the primary).
 */
played_by: PlayerId, 
/**
 * The strategy tokens that the follower has now.
 */
tokens_left: number, 
/**
 * Following costs the follower a strategy token.
 */
costs_token: boolean, };
