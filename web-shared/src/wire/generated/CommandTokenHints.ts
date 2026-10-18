// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.
import type { CommandPools } from "./CommandPools.ts";

/**
 * The facts of a command-token decision (display only, top-level keys of the details of a
 * `kind: "command_tokens"` question: a gained token's pool, Leadership's purchase, a
 * redistribution or a restack); see [`with_pool_details`].
 */
export type CommandTokenHints = { 
/**
 * `"gain"`, `"buy"`, `"redistribute"` or `"restack"`.
 */
mode: string, 
/**
 * The pools as they stand now (before the gain, for a redistribution that gains).
 */
pools: CommandPools, 
/**
 * The tokens in reinforcements, less the ones a redistribution gains.
 */
reinforcements: number, 
/**
 * The tokens still to place, this one included (gain), or 0 (buy). Left out otherwise.
 */
tokens_to_place?: number, 
/**
 * The tokens a redistribution or restack arranges, the gained ones included. Left out
 * otherwise.
 */
total?: number, 
/**
 * The tokens gained in the same redistribution (the status phase). Left out otherwise.
 */
gained?: number, };
