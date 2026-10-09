# ti4-wasm

The rules engine compiled to WebAssembly, for an offline hotseat mode in `web2/`.

This crate is a spike (2026-10-09). It answers three questions: how large the wasm file is, what
could make it smaller, and whether the engine's blocking decisions work in a browser. It is not
yet the interface that `web2` will use.

## Result

- The engine compiles to `wasm32-unknown-unknown` with one change: `rand` without default
  features in `ti4-engine` (`getrandom` has no backend for this target).
- The file is **4.20 MB, 0.78 MB with brotli**.
- A seeded six-player game gives the same state in wasm and natively.
- A decision of a player can suspend the engine and wait for a promise (JSPI). The engine needs
  no change for it.

## Size

The size of `ti4_wasm.wasm`; brotli at quality 11.

| Build | raw | gzip | brotli |
|---|---|---|---|
| `--release` (the workspace profile) | 6.19 MB | 1.89 MB | 1.23 MB |
| `--profile wasm-release` | **4.20 MB** | 1.08 MB | **0.78 MB** |
| `--profile wasm-release`, then `wasm-opt -Oz` | 3.49 MB | 1.14 MB | 0.83 MB |

- `wasm-release` is `opt-level = "z"`, `lto = "fat"`, `panic = "abort"` (workspace `Cargo.toml`).
- `wasm-opt` makes the file smaller but the download larger. Do not use it.
- The `--release` and `wasm-opt` rows were measured before the fixed buffers (see Memory); the
  `wasm-release` row was 4.22 MB then, so the rows compare.
- Speed: 2000 steps take about 7–12 s with `wasm-release` and about 6 s with `--release`, in
  Node. That is 3–6 ms for a step.

### Where the bytes are

From `twiggy` on an unstripped `wasm-release` build.

| Part | Size | |
|---|---|---|
| Code | 3.1 MB | |
| – `ti4_engine` | 1.27 MB | the faction modules are 0.43 MB of it |
| – `alloc` and `core` | 1.52 MB | generic code, compiled once for each type that uses it |
| – `serde_json`, `serde_core` | 0.17 MB | all serde-related code together is 0.2–0.3 MB |
| – all other crates | 0.1 MB | `ti4_model`, `ti4_content`, `rand`, `sha2`, the allocator (8 KB) |
| Data | 1.13 MB | |
| – content JSON | 0.96 MB | `ti4-content/content/*.json`, embedded as written |
| – other strings | 0.17 MB | |

The 1.52 MB of `alloc` and `core` is mostly `Vec`, slices and sorting (about 0.6 MB), `BTreeMap`
and `BTreeSet` (about 0.5 MB) and iterator adapters (about 0.25 MB). The split is by function
name and is approximate.

## What can be cut

| Candidate | Saves raw | Saves brotli | Verdict |
|---|---|---|---|
| Third-party dependencies | 0 | 0 | Nothing to cut. No crate is larger than 125 KB. |
| Minify the content JSON | 270 KB | 4 KB | Cheap, small. |
| Also drop flavour text, authors, short names, emoji fields | 330 KB | 24 KB | Small. Not checked: which of these fields Rust reads. |
| Also drop the map templates | 420 KB | 28 KB | Small. |
| Engine modules that hotseat does not use | 0 | 0 | The linker already removes them. |
| `Debug` implementations | 7 KB | – | Not worth it. |
| Fixed data structures in the engine (next section) | up to 1.1 MB | not measured | Large, and a rewrite. |

- These crates are in the manifests of `ti4-model`, `ti4-content` or `ti4-engine` and are not
  used there: `anyhow`, `tracing`, `globset`, `itertools`, `bitflags`, `smallvec`, `hashbrown`,
  `indexmap`. They cost no wasm bytes. Removing them saves build time only.
- `opening`, `observation`, `fixtures`, `fingerprint` and `registry` link to 0 bytes. `synergy`,
  `preview` and `decision_context` are 8 KB together.

## Later: an engine with fixed data structures (non-goal now)

The largest part that is not rules is the generic container code: 1.1 MB of `Vec`, `BTreeMap`
and iterator code. An arena alone does not remove it, because a `Vec<T>` in an arena is still
one copy of `Vec` for each `T`. What removes it is data structures made for this game:

- ids as small integers, not strings (the guess is that string ids, cloned and used as map keys,
  are the first thing to change; this is not profiled);
- arrays indexed by those ids in place of maps;
- bit sets for sets of players, systems, technologies;
- lists of a fixed capacity where the game has a limit (units of a kind, cards in a hand).

With such a layout the whole game state is one block of a known size. It is allocated once at
the start, or from an arena, and the engine does not allocate while it plays.

Expected effects, none of them measured:

- Size: up to 1.1 MB raw. A few hundred KB of download is a fair guess.
- Speed: probably faster than today. The state is compact and stays in the cache, a copy of the
  state is one `memcpy`, and a step does not allocate.
- Debugging: the state has a fixed address and a fixed layout, and a snapshot is a copy of bytes.

This is a rewrite of the engine and is a non-goal until hotseat works. The rule for new code in
the meantime is below.

## Memory in this crate

New code uses data structures that fit the use, with fixed or arena memory, so that it does not
have to be migrated when the engine changes.

- Everything that crosses the boundary is in a fixed static buffer (`src/buffer.rs`): the result
  of an export (`RESPONSE_CAPACITY`, 256 KiB) and the pending choice (`PENDING_CAPACITY`,
  64 KiB). A full game state is about 40 KiB and a choice about 1 KiB, as of this spike.
- A buffer never grows and never moves. The host reads every result at the same address.
- A value is serialized directly into its buffer. No intermediate `String` or `Value` is built.
- A value that does not fit fails the call at once. The error says what was too large, its size,
  the capacity, and the constant to raise:

  ```text
  ti4-wasm buffer full: the pending choice is 876 bytes, but PENDING_CAPACITY is 512 bytes.
  Raise PENDING_CAPACITY in crates/ti4-wasm/src/buffer.rs and rebuild, or make the pending
  choice smaller.
  ```

  The JS side throws it as an `Error`. A buffer is never cut short and never reallocated: the
  limits are there to be found.
- What still allocates in this crate is what the engine's interface asks for (owned ids, the
  boxed decider, the setup lists) and the text of an error. The engine itself allocates on every
  step, so the global allocator stays for now.
- Serializing goes through `dyn Write`. One copy of every serializer for each writer type cost
  39 KB.

## The boundary

Plain C ABI, no `wasm-bindgen`. The crate has its own `[lints]` because the boundary needs
`unsafe` attributes and the workspace forbids `unsafe`.

| Export | |
|---|---|
| `ti4_run_seeded(seed, max_steps) -> status` | Random deciders on all seats; the result is the state. |
| `ti4_play_hosted(seed, choices) -> status` | Seat `a` is answered by the host through `host.ask`. |
| `ti4_response_ptr()` | The address of the result or the error of the last export. |
| `ti4_pending_ptr()`, `ti4_pending_len()` | The choice the game waits in; length 0 when it does not wait. |

A status of 0 or more is the length of a JSON result. A status below 0 is the negated length of
an error text. The import `host.ask() -> i32` returns the index of the chosen option.

## Decisions with JSPI

The engine asks for a decision with a blocking call (`Decider::choose`). The server blocks a
thread for it. A browser cannot block its main thread, so the host wraps the import in
`WebAssembly.Suspending` and the export in `WebAssembly.promising` (`js/jspi.mjs`). The wasm
stack is parked until the promise of the answer settles.

- No threads, no `SharedArrayBuffer`, no cross-origin isolation headers.
- The glue is about ten lines of JS, written by hand.
- While the game is parked, other exports of the same instance can be called. They must not
  touch the game, which the parked stack has borrowed. They read a copy that was stored when the
  choice was offered: this is what the pending buffer is.
- Such a call must return before the game is resumed. Rust keeps a second stack in linear
  memory, and the calls share it.
- Undo cannot rewind a parked stack. It is a replay from the seed and the decision log.
- Checked in Chromium 156 only. Firefox and Safari are not checked. The fallback is a Web Worker
  that blocks in `Atomics.wait`; it needs cross-origin isolation, and a blocked worker cannot
  answer queries.

## Not done

- `ti4-server` does not compile to wasm (tokio, axum, threads, files). Its `protocol/`,
  `projection.rs`, `preset.rs` and `maps/` use none of these and could move to a crate that both
  sides use, if hotseat should show the same redacted view as online play.
- The other workspace crates were not rebuilt after the `rand` change. `ti4-engine`,
  `ti4-server` and `ti4-wasm` pass their tests.
- No UI queries, no saved games, no undo.

## Commands

```sh
rustup target add wasm32-unknown-unknown

# Build (about 2 minutes; the result is target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm)
cargo build -p ti4-wasm --target wasm32-unknown-unknown --profile wasm-release

# The same seed and step count must print the same line in wasm and natively
node crates/ti4-wasm/js/run.mjs target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm 3 2000
cargo run -p ti4-wasm --example run -- 3 2000

# JSPI in Chromium (from web2/, which has Playwright)
cd web2 && node ../crates/ti4-wasm/js/jspi.mjs ../target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm

# Where the bytes are
cargo install twiggy
cargo build -p ti4-wasm --target wasm32-unknown-unknown --profile wasm-release \
  --config 'profile.wasm-release.strip=false' --target-dir /tmp/ti4-wasm-names
twiggy top -n 40 /tmp/ti4-wasm-names/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm
```
