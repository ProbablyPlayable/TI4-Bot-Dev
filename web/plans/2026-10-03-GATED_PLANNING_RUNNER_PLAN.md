# Next step: a gated, disposable planning runner

## Goal

Let a player draft their next tactical action while another player is acting. Use a copy of the normal engine to generate legal questions and deterministic previews, and record the player's answers. Refresh by replaying those answers from a newer completed-step checkpoint. At the real opportunity, replay inputs through the live engine; never copy preview state back into it.

The next significant deliverable is a **server-side planning runner with a verifiable publication boundary**. It must demonstrate useful multiplayer movement planning and stop before publishing unknown outcomes or decisions derived from hidden information. A transport-neutral test harness is sufficient for this milestone; browser UI, durable plan storage, and automatic live execution come later.

This follows [Next action planning](2026-10-03-NEXT_ACTION_PLANNING.md) and narrows its execution-policy proposal. In particular, it changes the preview contract from “never internally sample or inspect” to:

> A disposable engine may compute an unknown outcome internally, but the runner must not publish that outcome, anything derived from it, or collect another planned answer based on it. Discard the attempted execution at that boundary.

This is an intentional distinction. If preventing internal access itself becomes a requirement, this design is insufficient and pre-access guards would be needed.

## Why the planning policy belongs outside the rules engine

The engine decides what is legal and applies the rules. Planning decides which hypothetical outputs are useful to expose, which opponent assumptions to make, when to stop, and how to retain and refresh a script. Those are session/product responsibilities.

Propagating planning errors through RNG, dice, transit, combat, invasion, exploration, relics, and every caller spreads an expected preview stop throughout the rules API. It also mixes planning boundaries with illegal choices and genuine engine failures. Existing helpers sometimes catch input errors or return `Option`/`()`; extensive error plumbing still needs an external latch and disposal contract to avoid accepting partial execution.

A disposable worker already lets us discard partial state. Use that property instead of requiring every rules function to unwind a new planning error. Keep the allowlist, projection validation, script management, stop reasons, and publication logic in the server. The engine continues to use its ordinary rule implementations and return types.

This does not mean zero engine changes. A few narrow hooks are necessary because a server decider cannot observe RNG activity or prevent hidden-hand-dependent eligibility checks that happen before a question exists. These hooks should observe execution or configure timing participation, rather than implement an alternate tactical executor.

## Current foundations and integration points

- `crates/ti4-engine/src/game.rs`: `Game::fork()` copies the mutable driver with fresh bindings; `prepare_hypothetical_turn()` prepares a selected player's hypothetical action turn.
- `crates/ti4-server/src/planning.rs`: `RecordedDecision`, `RecordingDecider`, and `ReplayDecider` already record and match fresh questions/options. Replay progress is latched because the engine may swallow decider errors.
- `crates/ti4-engine/src/choice.rs`: `Table::ask_seeing()` invokes `on_observed_offer()` **before** the decider. That callback receives full internal state. A planning worker must buffer it privately, not attach a live publisher.
- `crates/ti4-server/src/projection.rs` and the model's `view_for` redaction path produce client-facing views. Validate the actual planning envelope built with these projections, including choices, context, previews, and events.
- `crates/ti4-server/src/session/decider.rs`: `RemoteHumanDecider` publishes immediately. Do not reuse it as the planning input source; the planning decider must gate publication first.
- `crates/ti4-engine/src/rng.rs`: `stream()` exposes a mutable RNG, and RNGs can be cloned inside execution. Comparing only the game's top-level RNG misses activity on temporary copies.
- `crates/ti4-engine/src/timing.rs`: both eligibility paths can evaluate conditions before asking a decider. Opponent filtering must happen before those conditions.

## 1. The minimal runner contract

Keep two layers of progress distinct:

```text
PlayerPlan:
    revision
    base_checkpoint_id
    recorded_decisions

PlanningAttempt:
    generation_id
    disposable_game
    attempt_observation
    replay_progress
    last_accepted_step_checkpoint
    last_safe_publication
    nested_answers_since_checkpoint
    terminal_stop_or_failure
```

The attempt is disposable; the script survives. A nested offer can be safe to publish without being a copyable checkpoint: the Rust stack is still inside `step()`. Only successful, validated completed steps advance the engine checkpoint.

Expose outcomes such as:

```text
PlanningUpdate:
    SafeOffer(projected_position, projected_choice, replay_progress, assumptions)
    SafeStep(projected_position, replay_progress, assumptions)
    Stopped(generic_reason, last_safe_publication, replay_progress)
    Failed(sanitized_failure_category)
```

Every update includes checkpoint identity, plan revision, and attempt generation. A retired generation cannot publish. Stop reasons contain no sampled faces, card identities, private eligibility results, or discarded engine diagnostics.

If uncertainty was observed before an engine failure, report the generic uncertainty stop, not an outcome-dependent failure. Keep raw failure details in internal diagnostics; never forward speculative error strings to the player.

An answer accepted at a safe offer remains recorded even if applying it reaches uncertainty. For example, the script retains the gravity-rift move, but the preview never reports whether the ship survived. Answer consumption is not acceptance of its resulting state.

## 2. Gate every observable boundary

All planning output goes through one server-owned gate:

1. Buffer the raw offer/state/events privately.
2. Check cancellation, generation, and the terminal latch.
3. Check attempt observations for randomness or a reveal.
4. Check actor and the audited offer/context allowlist.
5. Construct the actual player envelope and validate its knowledge constraints.
6. Only then publish it or use a recorded answer to continue replay.

Apply the gate before **each nested question**, after every completed step, and before emitting any event or update. Replay is also gated: a recorded answer must not be supplied after uncertainty merely because the fresh question still matches.

The pre-decider observation callback only fills an attempt-local buffer. Both `choose()` and `choose_seeing()` must pass through the planning gate. An offer without sufficient observation/context for validation stops conservatively; it does not silently use stale state.

After a stopped nested offer, return an ordinary decider failure on cancellation/disposal if necessary, latch the attempt externally, and refuse all subsequent publication or answers. Even if the engine catches that failure and returns success, the attempt is rejected. No default/first-option fallback is permitted.

## 3. Observe uncertainty without changing rule return types

Introduce a small attempt-scoped observation handle, installed only on the disposable fork. It reports monotonic activity, not the unknown result:

- randomness accessed;
- hidden information revealed/inspected in a supported path;
- unsupported mandatory opponent participation, if encountered at timing eligibility.

RNG clones made **within** an attempt share the observation handle. A new game fork gets independent observation state, and a planning attempt never attaches its handle to the live game. Bind the observer before hypothetical preparation so setup work cannot escape observation.

Mark RNG access centrally in `GameRng::stream()`. Initially, access is conservatively treated as randomness even if the caller ultimately draws nothing; exact sample counting is unnecessary for this milestone. Checking only seed, active domains, or final stream positions is insufficient. Direct stream access and temporary cloned RNGs must both be covered.

Mark positive-count dice outcomes and valid rerolls centrally in `Dice` as well, including test-preloaded faces that consume no RNG. A zero-dice roll alone must not invalidate deterministic execution.

For supported hidden-information paths, add a marker immediately before ordered deck access or inspection. This is an observation, not a new fallible return type. Unsupported paths remain excluded by the allowlist. Do not instrument every card effect as a prerequisite for this milestone.

The runner reads only marker status at the gate. Any speculative faces, cards, events, or mutations remain internal and are discarded when a marker is set. No new `Planning` variants are needed in `IllegalChoice`, combat errors, or game errors.

## 4. An audited allowlist, not a list of familiar prompts

Identify permitted questions using structured decision source/subtype, actor, and option kind/semantics. Reused strings such as `decline`, vector-index option IDs, or display labels cannot identify a safe workflow by themselves. Missing or unknown identity stops conservatively.

The allowlist has two checks:

- **Offer permission:** is it safe to expose this entire question, its options, context, and preview?
- **Selection permission:** may this chosen option start the audited execution segment leading to the next gate?

Record why each allowed segment is safe: it uses public facts or the planner's already known holdings, or has a centralized uncertainty marker before any downstream publication. Inspect automatic effects between questions too. A safe-looking question does not prove its consequences are independent of hidden state.

Initial supported slice:

- the action menu, with tactical-action selection enabled and unsupported selections disabled or rejected by the planning wrapper;
- system activation;
- movement and route selection;
- cargo loading;
- deterministic arrival and movement completion, stopping at the first unaudited aftermath/production/invasion segment.

Verify the action menu's projected options as part of the audit; disabling a selection does not make an information-dependent label or preview safe to show.

Strategy/component actions, negotiations, scoring, later phases, card effects, and deck-inspection choices are outside this initial slice. In particular, “look at a hidden deck, then choose what to do with it” is excluded even if the follow-up choice has otherwise familiar option kinds.

Audit known automatic movement consequences, such as gravity rifts and frontier exploration. Marker-triggering movement can be recorded, but no derived offer or outcome is exposed. Extend the allowlist only alongside segment-specific verification.

## 5. Opponent assumptions at the timing boundary

Use the explicit assumption: **other players take no optional reactions in this hypothetical turn**. Include it in every planning envelope.

Add a narrow timing participation hook evaluated before opponent ability conditions in both eligibility paths:

- Skip optional opponent abilities without consulting their hand, condition, or private eligibility.
- Stop on unaudited mandatory opponent abilities before their conditions run, using the attempt marker/latch.
- Allow audited mandatory effects based only on public facts when needed by the supported slice.
- Stop at any required other-player question before projecting it or invoking its input source.

Do not skip opponents only when a playable card is found. Whether a question exists must not depend on their actual hand. Live timing behavior retains its ordinary participation policy.

## 6. Validate knowledge, not projection equality

Movement, payments, and other deterministic consequences are expected to change the player's projection. Full projection equality would reject useful previews.

Build a baseline knowledge inventory from the checkpoint's actual player view. For this milestone, allow deterministic public changes and consumption of already known private holdings; reject newly exposed card/objective identities and any unsupported private-information transition. The observer catches draw-and-discard or inspect-and-restore paths whose final holdings look unchanged.

Projection checks are a backstop, not proof of information independence. An unseen card could change trade goods, options, or an event without appearing in a private field. That requires the segment audit and markers. Pair-state tests below verify that hidden differences do not alter the visible transcript.

Use the actual server projection/redaction path. `choice::redacted_full_state()` redacts only other players' action cards and secret objectives and is not a complete player-safe snapshot.

## 7. Cancellation and reconstruction

A planning decider can wait inside a step for an answer. Its inbox must also accept cancellation; do not rely on a thread blocked forever at a stopped offer.

On refresh or edit:

1. Retire the generation and prevent further publication immediately.
2. Wake any blocked decider and cancel its input source.
3. Terminate/join the old bounded worker; discard all partial engine state and buffered output.
4. Fork the newer checkpoint, install fresh bindings/observation, prepare the hypothetical turn, and replay the retained script through the gate.

Use a step bound for automatic work and a bounded shutdown assertion in tests. Cancellation may return through an existing decider error; swallowed errors never clear the external latch. Workers have no authoritative storage, broadcast, or live-input bindings.

## Implementation sequence

1. Add a transport-neutral runner and captured-output harness next to server planning code. Define typed updates, generation checks, a private offer buffer, and terminal status.
2. Add the narrow attempt-observation and timing-participation hooks. Preserve existing rule return types and verify fork isolation and live behavior.
3. Audit and implement the initial tactical decision/selection allowlist and projected knowledge checks.
4. Wire existing recording/replay adapters behind the gate, preserving answers within interrupted steps and mismatch tails.
5. Add cancellation/refresh lifecycle and run the acceptance tests. Only after this milestone passes should the runner be connected to client transport and UI.

## Acceptance tests: what makes this step complete

Use real `Game::step()` execution and captured **outbound envelopes**, not just final fork state. Place runner tests under `crates/ti4-server/tests/` with a stable `planning_runner` test target; add focused engine tests for the narrow hooks.

| Scenario                                                   | Required observable result                                                                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Two-player deterministic movement                          | Planner receives activation, movement, and cargo offers; deterministic arrival matches an unrestricted hypothetical fork under the same no-optional-reactions assumption. Live state and RNG remain untouched. |
| Gravity-rift move, across different seeds                  | Move is recorded; preview stops without a survival result, sampled face, derived option, or post-roll event. The published transcript is identical across outcome-changing seeds.                              |
| RNG use through a temporary clone/direct stream            | Observer detects it before the next publication even when the top-level game's stream position is unchanged.                                                                                                   |
| Preloaded dice and zero dice                               | A positive preloaded outcome stops publication; zero dice alone does not.                                                                                                                                      |
| Ordered draw/frontier exploration with different deck tops | No RNG is required for detection. No new card, card-derived goods, events, or follow-up offers escape; transcript and generic stop are identical.                                                              |
| Inspection followed by a decision, or draw-and-discard     | The segment is excluded or marked; unchanged final holdings cannot allow the follow-up question through.                                                                                                       |
| Opponent empty hand versus playable reaction card          | Optional eligibility conditions are never called; preview transcript is identical and still reaches movement drafting. Live execution still opens real reactions.                                              |
| Required opponent choice/unaudited mandatory ability       | Stop without opponent options, private conditions, or input callbacks being exposed/invoked.                                                                                                                   |
| Nested unknown offer during one step                       | Pre-decider callback only buffers privately; the rejected offer never reaches the outbound sink or replay answer source.                                                                                       |
| Caught decider error                                       | A subsequent success-shaped step cannot publish or become a checkpoint after the external latch stops the attempt.                                                                                             |
| Replay mismatch and reconstruction                         | First mismatch stops; remaining script survives. Rebuilding replays nested answers from the completed-step checkpoint, without copying a suspended stack.                                                      |
| Refresh while waiting                                      | Worker wakes and terminates within the test deadline; old-generation submissions/updates are rejected and no old buffers publish.                                                                              |
| Engine failure                                             | Report `Failed` separately from expected `Stopped`, without publishing the rejected speculative state.                                                                                                         |

For each hidden-state pair, compare the complete projected transcript: state, choice/options/context/previews, events, assumptions, and stop classification. Changing unknown state must not change whether or where output is published within the audited slice. Do not expose or compare private debug messages as client output.

Suggested verification commands after implementation:

```sh
cargo test -p ti4-server --test planning_runner
cargo test -p ti4-engine
cargo test -p ti4-server
```

The milestone is complete when these scenarios pass and a two-player fixture can draft a useful deterministic movement prefix, retain an uncertainty-crossing answer, and reconstruct safely after refresh. Merely stopping every multiplayer preview at `TURN_BEGAN` does not satisfy the goal.

## Later work

Connect completed live-step checkpoints to per-player refresh, add authenticated planning messages/UI, persist scripts, and install recorded inputs ahead of live human input. Expand support to production, invasion, strategy, and component actions incrementally, with the same segment audits and paired-hidden-state tests. The rules engine remains the single executor throughout.
