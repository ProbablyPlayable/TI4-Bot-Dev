// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * A cultural planet that Economic Initiative would ready (display only, in
 * [`crate::game::TurnMenuCardEffect::ReadyCultural`] of the turn menu).
 */
export type CulturalPlanetPreview = { 
/**
 * The planet's id.
 */
id: string, 
/**
 * Its printed name (the id when the corpus has none).
 */
name: string, 
/**
 * Always `"cultural"`.
 */
trait: string, 
/**
 * Whether it is exhausted now (so whether the card will change it).
 */
exhausted: boolean, };
