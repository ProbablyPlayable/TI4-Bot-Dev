// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { CulturalPlanetPreview } from "./CulturalPlanetPreview.ts";

/**
 * What a held action card's play would touch (display only, in
 * [`TurnMenuHints::action_card_effects`]).
 */
export type TurnMenuCardEffect = { "kind": "ready_cultural", 
/**
 * The cultural planets the seat controls, with whether each is exhausted.
 */
planets: Array<CulturalPlanetPreview>, };
