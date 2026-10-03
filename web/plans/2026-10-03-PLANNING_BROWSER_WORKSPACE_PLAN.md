# Browser planning workspace

## Goal

Let a player draft and inspect a tactical move while another player acts, using the existing gameplay UI. Provide an easy Live/Draft switch, automatic draft refresh after completed live steps and undo/redo, and a clear indication when the live game needs the player's answer.

This milestone covers activation, movement, and cargo. Automatic execution in the live game and production planning come later.

## Current State

- The gated planning runner produces player-projected offers and positions, records answers, and reports movement completion, uncertainty, replay mismatch, and sanitized failures.
- Session integration retains scripts and reconstructs attempts from completed live-step checkpoints, including undo/redo.
- Authenticated `StartPlanning` and `SubmitPlanningChoice` WebSocket messages exist. Planning updates are seat-only, with delivery independent of a waiting live decider.
- The browser does not yet decode or display planning messages.
- `Board`, `ChoiceRendererDispatcher`, activation/movement/cargo overlays, and the client-side move/load pipeline provide the existing interaction model. Workflow state is split between `GameShell`, pipeline owners, and individual overlays.

## Target State

- The header offers **Start tactical draft** when no draft exists, then a persistent **Live / Draft** switch. Starting a draft opens Draft mode.
- Draft mode uses the same board and decision overlays as Live mode, including the move/load pipeline, backed by planning inputs and projected positions.
- Each workspace preserves its own map position, selected systems/options, staged units, minimized overlays, and workflow progress when switching.
- A live question never switches modes or steals focus. The Live tab pulses and displays **Your decision**; Draft mode also shows **The live game is waiting for you** with a one-click switch. Respect reduced-motion preferences. Sound is later work.
- A compact draft status strip labels the view **Hypothetical**, displays the no-optional-opponent-reactions assumption, and reports refresh, completion, uncertainty, mismatch, or failure. Existing overlays provide the decision controls.
- Refresh replaces the disposable preview while retaining the recorded script. Retired controls cannot submit answers, and stopped previews remain inspectable without actionable choices.

## Implementation Details

### Protocol and session client

- Mirror the existing Rust planning messages and Serde enum shapes in `web/src/protocol/types.ts`; validate them in `decode.ts`.
- Add independent planning state, submission promises/errors, and start/answer methods to `GameSessionClient`; expose them through `useGameSession`.
- Keep planning updates separate from the live snapshot, pending choice, event log, and history. Capture the full displayed attempt identity with every answer.
- Reject older updates and ignore stale acknowledgments using checkpoint identity, generation, and plan revision. Checkpoints distinguish reconstructed sessions even when generation numbering restarts.
- Add seat-only refresh/invalidation and availability notifications where needed so controls are disabled as soon as an attempt retires, before its replacement publishes. Do not infer checkpoint refresh from every live version change.
- On reconnect or history-driven socket replacement, keep the draft but disable cached controls until current server planning state arrives.

### Shared UI, independent workspaces

- Add the shared mode switch in `App`/`GameShell`, with two stable workspace instances or equivalent per-workspace state ownership. Reuse `Board`, `ChoiceRendererDispatcher`, and the existing workflow components.
- Give each workspace its own selections, movement execution state, pipeline context, and submission adapter. Adapt planning publications to the existing board/choice interfaces; derive a local offer key from the full attempt identity for nonce-based resets.
- Route draft answers through planning transport. Reuse the client-side move/load pipeline against fresh planning offers; do not send draft batches to live batch endpoints.
- Keep inactive workspace state mounted or explicitly retained. Suppress inactive overlays and release their focus traps/Escape handlers without treating switching as workflow dismissal.
- Keep the mode switch reachable while decision overlays are open, including through shared overlay chrome if necessary.
- An explicitly started pipeline continues across mode switches. Refresh pauses it, invalidates old bindings, and lets server replay reconstruct the recorded prefix. Revalidate remaining local intent against fresh offers before resuming; never resubmit the recorded prefix.
- Preserve unsubmitted staging as local intent across refresh where possible, but disable it until revalidated. Report unavailable selections rather than silently substituting another option.

### Status and attention

- Add a small draft status strip: preparing/refreshing, ready, movement complete, uncertainty, unsupported boundary, replay mismatch, and sanitized failure. Include replay progress when useful.
- Use only the current attempt's safe publication. During refresh, label any retained display **Previous preview · refreshing** and make it non-actionable. Never enable a choice from a stopped update's last-safe publication.
- Derive live attention from any outstanding decision addressed to the viewer, including reactions. Keep the indicator until the decision resolves; switching to Live alone does not clear it.

### Verification

- Add focused client/workspace tests for attempt freshness, independent state retention, pipeline routing and refresh cancellation, stopped controls, and live attention without automatic switching.
- Add a real-server browser scenario with A, B, and a spectator: A waits at a live question; B drafts activation/movement/cargo and inspects the hypothetical position; A moves; B refreshes or reports mismatch; undo/redo reconstructs B's retained draft.
- Verify mode switches preserve staging and workflow progress, including during an in-flight pipeline. Verify retired clicks/acknowledgments cannot affect the replacement attempt.
- Inspect WebSocket traffic as well as the DOM: A and spectators receive none of B's planning offers or answer results, and B receives updates while A's live decider is waiting.
