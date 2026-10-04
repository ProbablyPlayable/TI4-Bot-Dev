# Adding state forks and decision replay

## Goal

Reduce waiting by letting players prepare decisions while others take their turns. Replay those decisions against the latest state as the game advances, then apply them when the real opportunity arrives.

Use the existing engine for both planning and execution to avoid duplicating rules. Keep the integration small enough to reuse in other digital board games, without exposing future random outcomes or hidden information.

## 1. The core model

Keep just two things per player:

```text
PlayerPlan {
    revision,
    base_checkpoint_id,
    recorded_decisions,
}

PlanningSession {
    disposable_engine_copy,
    replay_progress,
    next_choice_or_stop_reason,
}
```

The decision script is the durable part. The engine copy is a cache.

The lifecycle becomes:

```text
After a successful live step:
    publish a complete engine checkpoint
    refresh each player's planning session:
        copy checkpoint
        prepare hypothetical turn for that player
        replay their recorded decisions
        stop at the first mismatch or uncertainty

When the player edits their plan:
    answer choices produced by the planning engine
    append or replace recorded decisions

When the real opportunity arrives:
    replay the decisions through the real engine's fresh choices
    stop when a choice no longer matches or live input is needed
```

**Never copy the planning state back into the live game.** Only replay its inputs. This prevents hypothetical turn bookkeeping from becoming authoritative.

No separate tactical executor, movement rules, resource ledger, or production simulation is needed: the copied engine does all of that.

## 2. “Copyable after a step” is the right boundary—with one distinction

Once `Game::step()` returns, its local stack is gone. That removes the hard problem of cloning a suspended Rust continuation.

However, the copy needs to include **the complete mutable engine**, not just `GameState`.

[`game.rs:794`](../../crates/ti4-engine/src/game.rs) contains persistent state outside `GameState`, including:

- movement, combat, production, and strategy windows;
- RNG streams and dice;
- resolver usage and event allocation;
- turn preparation and action counters.

So the requirement is:

> At every successful step boundary, the complete rules state can be cloned into an independent engine with fresh input/output bindings.

That suggests a relatively mechanical separation:

```text
Engine state: board + windows + RNG + timing bookkeeping + driver flags
Runtime bindings: deciders + channels + callbacks + persistence
```

Immutable content can be shared. Mutable rules state must be copied. Network and persistence bindings must be replaced.

This is much smaller than making every nested timing window resumable.

## 3. Faking a turn should be one small adapter

I agree with the spirit of “overwrite `active` and a handful of other fields.”

But **a returned step is not necessarily an idle action boundary**. It can leave another player's movement or production window open. In the current driver, those windows take precedence over `active`; changing `active` alone would continue the existing workflow.

I would add one engine-local operation:

```text
prepare_hypothetical_turn(player)
```

Its job is to:

1. Discard the copied driver's current workflow continuation.
2. Establish a fresh action opportunity for the selected player.
3. Reset turn-local driver bookkeeping.
4. Synchronize timing priority and duration bookkeeping.
5. Run the existing turn-start/action path under the planning policy.

It should preserve the copied board, holdings, exhausted planets, tokens, and other actual game facts.

**This adapter prepares execution; it does not implement tactical rules.** After it runs, planning calls the normal `step()`.

Where practical, actual and hypothetical turn setup should share the same turn-initialization helper. That avoids duplicating even the bookkeeping.

The preview means:

> “If you could begin a turn from the latest completed-step position.”

During somebody else's unfinished action, that position is provisional. Refreshing after subsequent successful steps naturally updates it.

## 4. Record decisions, with just enough identity to replay safely

We can drop the proposed intent graph and most of the workflow-identity infrastructure for an initial version.

However, recording only option IDs is too weak here. Some movement IDs contain vector indexes, and IDs like `"decline"` are reused across unrelated prompts.

A small recorded decision can contain:

```text
RecordedDecision {
    expected_actor,
    expected_choice_context,
    selected_option_kind,
    selected_option_semantics,
}
```

Replay is strictly sequential:

1. Check that the fresh question matches the expected question.
2. Find exactly one fresh option matching the recorded selection.
3. Submit that fresh option.
4. Otherwise stop and retain the remaining script.

Start with exact context and payload matching. Add small normalization rules where indexes are unstable—for example, identify a ship by origin, type, and relevant condition rather than its old vector index.

This is an **input matcher**, not another rules implementation.

For the first version, “first mismatch stops replay” is enough. No dependency graph, automatic repairs, or search ahead for a later matching question.

## 5. Nested questions do not require nested forks

One wrinkle in this engine: **one `step()` can ask multiple questions**. For example, `step_secondary()` calls strategy effects that ask nested choices before returning.

You still have two simple options:

- Keep a disposable planning worker waiting inside that step while the player answers.
- To reconstruct it, restart from the last completed-step checkpoint and replay the answers already collected within that step.

Neither requires copying a suspended stack.

If the live game advances while that planning worker is waiting, discard it and rebuild from the new checkpoint. The recorded answers survive.

An interrupted or failed planning step must not become a new checkpoint. Some current paths swallow choice errors, so “return an error and then keep the resulting state” would not be reliable. Capture the offer/result you need, latch the stop, and discard that attempted execution.

## 6. RNG and hidden information need an execution policy

This is the part that cannot be guaranteed by copying and replay alone.

I would phrase your requirement as:

> Planning may select an action that eventually causes randomness or reveals information, but must stop before observing the unknown result.

For example, moving through a gravity rift can be planned. Its survival cannot be previewed using the copied live RNG.

Use a small planning policy around the existing execution:

| Operation                                          | Planning behavior                |
| -------------------------------------------------- | -------------------------------- |
| Ordinary deterministic rules                       | Execute normally                 |
| Planner's decision using already known information | Ask or replay                    |
| Random outcome                                     | Stop before sampling             |
| Draw, inspection, or other new hidden information  | Stop before accessing the result |
| Required decision by another player                | Stop                             |
| Optional opponent reaction                         | Apply an explicit policy         |

**Blocking RNG alone is insufficient.** Decks are already ordered, and drawing from them may use no RNG at all. Hidden holdings can also affect which reaction questions exist.

For optional reactions, there is a useful tradeoff:

- **Strict planning:** stop at every possible reaction window.
- **Useful hypothetical planning:** uniformly assume opponents take no optional reactions, and label that assumption.

I would favor the second for tactical drafting. Crucially, it must skip optional opponent responses **without consulting whether they actually hold a relevant card**. Otherwise the preview becomes a hidden-information oracle.

Live execution always opens the real reaction windows.

This needs a few hooks at randomness, information-reveal, and timing boundaries. It does not need alternate tactical code. Unsupported paths can initially stop conservatively.

## 7. Execution can be ordinary prefilled input

When it really is the player's opportunity, install the script as a source of answers ahead of normal human input:

```text
Fresh engine choice:
    if next recorded decision matches:
        use its matching fresh option
    else:
        ask normally
```

If another actor needs input, normal live play handles it. Subsequent recorded decisions can remain queued for the corresponding continuation.

Live execution may roll dice and draw cards normally. The planning restriction applies to previews, not to the real action.

For changed circumstances, I would keep the policy simple:

- Missing or ambiguous selection: pause.
- Still matching selection: executable.
- Show the refreshed preview and replay progress.

The document's comprehensive consequence certificates are optional product behavior, not a prerequisite for this model. For example, whether a stronger enemy fleet requires renewed confirmation is a UX choice. It need not become a generalized engine contract.
