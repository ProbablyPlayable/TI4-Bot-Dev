// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Display only: one staged die of a reroll window, as [`staged_dice_view`] lists it (the `dice`
 * of a die-by-die reroll question, [`RerollDiceHints`], and of a Munitions Reserves question,
 * [`crate::faction_abilities::MunitionsRollHints`]).
 */
export type StagedDie = { 
/**
 * The unit type that made the roll this die belongs to.
 */
unit: string, 
/**
 * The roll entry's position in the staged set.
 */
unit_index: number, 
/**
 * The die's position within its roll entry.
 */
die: number, 
/**
 * The face the die shows now.
 */
face: number, 
/**
 * The adjustment sitting on this die (Thalnos's +1), 0 when none.
 */
bonus: number, 
/**
 * The value the roll hits on; `null` for a roll that is not a hit roll.
 */
hits_on: number | null, 
/**
 * Whether some reroll already replaced this die.
 */
rerolled: boolean, };
