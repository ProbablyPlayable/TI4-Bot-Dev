# ti4-wasm

The rules engine compiled to WebAssembly, for an offline hotseat mode in `web2/`.

It began as a spike (2026-10-09) that answered three questions: how large the wasm file is, what
could make it smaller, and whether the engine's blocking decisions work in a browser. `web2` now
plays a game through it (see "Local play in web2").

## Result

- The engine compiles to `wasm32-unknown-unknown` with one change: `rand` without default
  features in `ti4-engine` (`getrandom` has no backend for this target).
- The file is **4.30 MB, 0.80 MB with brotli**, with the projections of `ti4-view` included.
- A seeded game of three to eight players gives the same state in wasm and natively.
- A decision of a player can suspend the engine and wait for a promise (JSPI). The engine needs
  no change for it.
- The host gets what a client of the server gets: the redacted view, the pending choice and the
  turn status (`SessionUpdate` from `ti4-view`, the shared part of the server's `StateUpdateMsg`).

## Size

The size of `ti4_wasm.wasm`; brotli at quality 11.

| Build | raw | gzip | brotli |
|---|---|---|---|
| `--release` (the workspace profile) | 6.19 MB | 1.89 MB | 1.23 MB |
| `--profile wasm-release` | 4.20 MB | 1.08 MB | 0.78 MB |
| `--profile wasm-release`, then `wasm-opt -Oz` | 3.49 MB | 1.14 MB | 0.83 MB |
| `--profile wasm-release`, with `ti4-view` | **4.30 MB** | 1.11 MB | **0.80 MB** |

- `wasm-release` is `opt-level = "z"`, `lto = "fat"`, `panic = "abort"` (workspace `Cargo.toml`).
- `wasm-opt` makes the file smaller but the download larger. Do not use it.
- The `--release` and `wasm-opt` rows were measured before the fixed buffers (see Memory); the
  `wasm-release` row was 4.22 MB then, so the rows compare.
- The projections cost 0.10 MB raw and 0.02 MB of download. The first three rows and the
  breakdown below are without them.
- With the map templates and their builder the file is 4.52 MB raw and 1.13 MB with gzip
  (brotli not measured). The table and the numbers above are from before that.
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
  of an export (`RESPONSE_CAPACITY`, 256 KiB) and the update for the host (`UPDATE_CAPACITY`,
  512 KiB). A full game state is about 40 KiB. An update of a game of eight is 26 KiB at the
  start, and the largest of one full game (seed 3) was 42 KiB.
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
- The views allocate too. A decider is given no game state, so the run keeps a copy of the state
  and refreshes it after each step and at each choice that the engine offers with its position,
  and `ti4-view` builds a `GameView` of maps and vectors from it. Both are shaped by the engine's types and change with them. The view is then serialized
  directly into its buffer.
- Serializing goes through `dyn Write`. One copy of every serializer for each writer type cost
  39 KB.

## The boundary

Plain C ABI, no `wasm-bindgen`. The crate has its own `[lints]` because the boundary needs
`unsafe` attributes and the workspace forbids `unsafe`.

| Export | |
|---|---|
| `ti4_run_seeded(seed, players, max_steps) -> status` | Random deciders on all seats; the result is the state. |
| `ti4_play(seed, players, human_mask) -> status` | Plays a game to its end. A seat whose bit is set in the mask (bit 0 is seat `a`) is answered by the host through `host.ask`; the others decide at random. |
| `ti4_response_ptr()` | The address of the result or the error of the last export. |
| `ti4_update_ptr()`, `ti4_update_len()` | The update for the host: while the game waits in a choice, and after `ti4_play` has returned. Length 0 when there is none. |

The result of `ti4_run_seeded` has the state and, as `view`, what seat `a` is shown of it.

A status of 0 or more is the length of a JSON result. A status below 0 is the negated length of
an error text.

The update is `{ viewer, view, pending_choice, turn_status }`, with the names and shapes of the
same fields of the server's `StateUpdateMsg`. A test of `ti4-server` keeps them equal
(`a_session_update_is_the_shared_part_of_a_state_update`). The viewer is the seat that is asked.
The nonce of a choice is its number in the game.

The import `host.ask() -> i32` returns the index of the chosen option. A negative answer leaves
the game: every later choice fails without asking, the run unwinds, and `ti4_play` returns with
`stopped` set. A choice with one option is asked like any other, as on the server: the engine
itself skips the choices that need no answer.

## Decisions with JSPI

The engine asks for a decision with a blocking call (`Decider::choose`). The server blocks a
thread for it. A browser cannot block its main thread, so the host wraps the import in
`WebAssembly.Suspending` and the export in `WebAssembly.promising` (`js/jspi.mjs`). The wasm
stack is parked until the promise of the answer settles.

- No threads, no `SharedArrayBuffer`, no cross-origin isolation headers.
- The glue is about ten lines of JS, written by hand.
- While the game is parked, other exports of the same instance can be called. They must not
  touch the game, which the parked stack has borrowed. They read a copy that was stored when the
  choice was offered: this is what the update buffer is.
- Such a call must return before the game is resumed. Rust keeps a second stack in linear
  memory, and the calls share it.
- Undo cannot rewind a parked stack. It is a replay from the seed and the decision log.
- Checked in Chromium 156 only. Firefox and Safari are not checked. The fallback is a Web Worker
  that blocks in `Atomics.wait`; it needs cross-origin isolation, and a blocked worker cannot
  answer queries.

## Local play in web2

`web2/?local=<seed>&players=8&humans=<mask>` plays a game of this engine in the shell of web2.
`humans=1` is seat `a` against seven random seats. `humans` is a mask of the seats that are
played in the page.

- `web2/scripts/build-wasm.sh` builds the file and copies it to `web2/src/session/ti4.wasm`
  (not in the repository).
- `web2/src/session/` is the client side: `Transport` (updates in, `submitChoice` out),
  `wasmTransport.ts` (the JSPI glue), the selectors from an update to the view models of web2,
  and `useLiveSession`. A websocket transport for the server needs the same two things.
- Every decision is one list in the action panel. A choice of systems is made on the board.
  The dedicated screens of web2 are not connected yet.
- `cargo run -p ti4-wasm --example record -- <seed> <players> <mask> <choice number>` writes the
  update of one choice. The selector tests of web2 use two such files.

### The saved game

A game is not kept as its state. It is kept as what plays it again
(`web2/src/session/savedGame.ts`): the seed, the number of seats, the human seats, the SHA-256 of
the engine file, and the option id of each answer of the page. The random seats and the dice
follow the seed, so the answers are the only input that is missing. The server keeps a game the
same way: an init record and the decision log.

- Where: `localStorage`, key `ti4.local.<seed>.<players>.<humans>`, written whole after each
  answer. The bar under the shell has New game, Export and Import (a JSON file).
- A reload plays the answers again and stops at the first choice without one. Undo plays them
  again without the last one. The engine waits for an answer in the middle of a step, on its
  stack, so a position between two answers cannot be stored and resumed.
- An answer that the replayed game does not offer stops the replay. The error names the number
  of the answer, its id and the ids that are offered.
- A saved game of another engine file is not replayed before the player says so: another
  engine may play the same answers differently, and not every difference gives an illegal id.

### Measurements

`cd web2 && node ../crates/ti4-wasm/js/bench.mjs src/session/ti4.wasm` plays one full game in
Chromium: seed 3, eight seats, seat `a` answers option `7n mod options` at its n-th choice.
The game has 296 choices of seat `a` and 2619 decisions in all.

| What | Time |
| --- | ---: |
| Random seats between two choices: median | 9 ms |
| the same, 90% of the choices | under 0.15 s |
| the same, 99% | under 0.51 s |
| the same, longest | 0.57 s |
| Whole game | 14.6 s |
| of that, reading the 296 updates in JS | 0.14 s |
| Replay up to answer 50 (resume or undo there) | 1.8 s |
| Replay up to answer 150 | 5.6 s |
| Replay up to answer 296 | 14.2 s |
| Writing the save, 296 answers (3.7 KiB) | 0.08 ms |
| Writing the save, 5000 answers (59 KiB) | 0.7 ms |
| Writing the save, 50000 answers (589 KiB) | 6.6 ms |

- Writing the whole save after each answer is not a bottleneck. No game comes near 5000 answers.
- The replay is the bottleneck: it costs all the engine time of the game so far. The page
  shows how far it is, but an undo late in a game takes over ten seconds.
- The time is the engine's, not the boundary's. The same game with random deciders only (2678
  decisions) takes 8.3 s natively (`--release`), 12.4 s in this file, and 7.9 s in a wasm file
  built with `opt-level = 3` (6.8 MB before compression in place of 4.5 MB). That is about
  3 ms for each decision natively.
- A CPU profile of that game (Node, a build with names) has no single hot function. The time is
  allocation, `String` and `Vec` clones and `BTreeMap` walks. By caller: `Game::apply_choice`
  26%, `Game::advance_turn` 25%, `Game::legal_options` 20%;
  `transactions::may_transact` 18% (it computes the neighbours of a seat each time);
  `fleet::enforce_everywhere` 12%, nearly all of it `units::catalogue`, which builds its map
  on each call; `Resolver::checkpoint` 9%; the copy of the state for the host at each offer 6%.
  The shares overlap.

Limits:

- The random seats play on the main thread between two choices, and the page does not respond
  in that time (see the table).
- An undo or a reload late in a game takes as long as the game took the engine so far.
- With `humans` naming more than one seat, the page shows the hand of the asked seat at once.
  There is no hand-over screen.
- The view has ids, not names. web2 shows technologies by id and has a small table for the
  names and commodity values of the eight factions (`session/select/names.ts`).
- Systems outside the map (the wormhole nexus, the fracture) are not on the board of web2.
- The view does not say whose home a system is, and has no combat strength.

## Eight players

A game is set up on the recommended map template for its player count (`ti4-view`, source set
Prophecy of Kings). Seven and eight players work through three marked hacks (search for `HACK`):

- `ti4-engine/src/seating.rs`, `EXTRA_SEAT_FACTIONS`: seats seven and eight play Sardakk N'orr
  and Yin, which are not fully ported. They are not in `IN_SCOPE_FACTIONS`.
- `ti4-view/src/maps/build.rs`: a hyperlane tile that a template places a second time is
  replaced by another hyperlane tile. Hyperlane paths are not modelled, so nothing is lost today.
- `ti4-view/src/maps/build.rs`: when the filler pool (planet systems) is empty, the open slots
  get the other numbered tiles (anomalies, empty space, wormholes) in tile order.

The templates `7pStaticEq` and `8pStaticEq` still do not build: they name a tile `0g` that the
content does not have.

## Not done

- `ti4-server` does not compile to wasm (tokio, axum, threads, files). The views and the code
  that makes them from a state are in `ti4-view`, which both sides use. Still in the server: the
  messages (`protocol/`, which needs the planning runner), the decision facts and event history,
  `preset.rs` and `maps/`.
- The view of a seat is as old as the last finished step, apart from the combat and invasion
  boundary, which is current. The server has the same limit.
- The JSPI check reads the update at each choice, but nobody holds an action card that early, so
  it does not show the redaction. The tests of `ti4-server` do (`tests/projection_redaction.rs`).
- The other workspace crates were not rebuilt after the `rand` change or the move to
  `ti4-view`. `ti4-engine`, `ti4-view`, `ti4-server`, `ti4-bot-agent` and `ti4-wasm` pass their
  tests. `ti4-advisor` uses the moved paths through the re-exports of `ti4-server` and was not
  built (it needs libtorch).
- No UI queries, no bots other than random. Undo and resume are replays from the seed; a stored
  position that can be resumed would need the engine to stop at step boundaries only.

## Commands

```sh
rustup target add wasm32-unknown-unknown

# Build (about 2 minutes; the result is target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm)
cargo build -p ti4-wasm --target wasm32-unknown-unknown --profile wasm-release

# The same seed and step count must print the same line in wasm and natively
# (arguments: seed, steps, players)
node crates/ti4-wasm/js/run.mjs target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm 3 2000 8
cargo run -p ti4-wasm --example run -- 3 2000 8

# JSPI in Chromium (from web2/, which has Playwright)
cd web2 && node ../crates/ti4-wasm/js/jspi.mjs ../target/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm

# Where the bytes are
cargo install twiggy
cargo build -p ti4-wasm --target wasm32-unknown-unknown --profile wasm-release \
  --config 'profile.wasm-release.strip=false' --target-dir /tmp/ti4-wasm-names
twiggy top -n 40 /tmp/ti4-wasm-names/wasm32-unknown-unknown/wasm-release/ti4_wasm.wasm
```
