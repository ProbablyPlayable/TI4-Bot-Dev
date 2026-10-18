// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { TurnMenuCardEffect } from "./TurnMenuCardEffect.ts";
import type { TurnMenuPartner } from "./TurnMenuPartner.ts";
import type { TurnMenuStrategyCard } from "./TurnMenuStrategyCard.ts";
import type { TurnMenuTokens } from "./TurnMenuTokens.ts";

/**
 * The facts of the persistent action bar (display only, top-level keys of the details of a
 * `kind: "turn_menu"` question, an action-phase turn or the close of one); see
 * `Game::with_turn_menu`. Never read by the engine.
 */
export type TurnMenuHints = { 
/**
 * What a held action card's play would touch, keyed by the option that plays it.
 */
action_card_effects: { [key in string]: TurnMenuCardEffect }, 
/**
 * Whether the turn is closing (its action is taken; only free options and the end remain).
 */
closing: boolean, 
/**
 * The actions taken this turn.
 */
actions_taken: number, 
/**
 * The seat's command-token pools.
 */
tokens: TurnMenuTokens, 
/**
 * Every strategy card the seat holds, in its order.
 */
strategy_cards: Array<TurnMenuStrategyCard>, 
/**
 * Every other seat, in seating order, with whether a transaction can be opened now.
 */
partners: Array<TurnMenuPartner>, };
