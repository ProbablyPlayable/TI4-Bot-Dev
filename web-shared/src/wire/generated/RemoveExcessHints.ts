// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * Where the seat stands in the system of a remove-excess question (display only, top-level
 * keys of its details, [`REMOVE_EXCESS_SUBTYPE`]), so a client can say "7 ships against a fleet
 * supply of 6".
 */
export type RemoveExcessHints = { 
/**
 * What the seat is over: `fleet supply` (37) or `capacity` (16).
 */
reason: string, 
/**
 * The system the unit is removed from.
 */
system: string, 
/**
 * Ships charged against the fleet supply ([`Standing::fleet_charged`]).
 */
fleet_charged: number, 
/**
 * The fleet supply ([`Standing::fleet_limit`]).
 */
fleet_limit: number, 
/**
 * Capacity consumed in the space area ([`Standing::consumed`]).
 */
capacity_consumed: number, 
/**
 * Capacity the ships present provide ([`Standing::transport`]).
 */
capacity_transport: number, };
