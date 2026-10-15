// Generated from the Rust types by `cargo wire-web` (ti4_wasm::wire_ts). Do not edit.

/**
 * The position of a save (`HostSave::position`). A resume reads it only with the same engine:
 * `build` and `content_digest` as the save's `engine`.
 */
export type SavedPosition = { build: string, content_digest: string, 
/**
 * The number of decisions of the save that the position was taken after.
 */
log_len: number, 
/**
 * The [`Position`] as JSON text. It is text so that the page keeps it as it is: the
 * engine's numbers may be larger than a JavaScript number holds.
 */
data: string, };
