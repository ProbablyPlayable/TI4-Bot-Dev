# Tactical draft UX

## Goal

Make Draft a temporary, reversible place to prepare one upcoming tactical action. Use it while waiting and as the normal tactical preparation flow on your own turn.

The player prepares an action, checks the preview, makes changes, then applies it to Live. The first version covers activation, movement, and cargo. Later resolution continues in Live.

This plan updates the flow in [Browser planning workspace](2026-10-03-PLANNING_BROWSER_WORKSPACE_PLAN.md).

## Flow

1. While waiting, click **Draft tactical action**. On your turn, choosing **Tactical action** opens the same flow. Reuse an existing draft when one exists.
2. Start with system selection. Do not ask the player to choose Tactical again inside a tactical draft.
3. Stage activation, movement, and cargo. Show the preview and allow editing, undo, and redo.
4. Keep staging, map position, and open controls when switching between Live and Draft.
5. Enable **Apply to Live** at the player's real tactical action opportunity, once the current draft passes validation.
6. Show a short confirmation with the destination, fleet, cargo, and cost. After confirmation, switch to Live and execute the recorded choices.

Apply must include the choices the player sees staged. Disable it during unsubmitted edits, an unfinished pipeline, or refresh. Never silently leave selected ships or cargo out of the applied action.

## Availability

The server checks the rules and gives the browser a short reason when drafting is unavailable.

| Situation | Behavior |
| --- | --- |
| Waiting in the Action phase with a legal tactical action to prepare | Enable **Draft tactical action** |
| Own tactical-capable action menu is open | Enable drafting; choosing Tactical opens Draft |
| Own live action is already underway | Disable new drafting: **Finish this action first** |
| Passed for the round | Disable drafting: **Passed for this round** |
| Strategy, Status, or Agenda phase | Disable drafting: **Available in the Action phase** |
| Disconnected | Keep an existing preview, disable its controls, and show **Reconnecting…** |
| Spectator or finished game | Hide the drafting entry |

A passed player who receives a real extra-action opportunity can draft that action. That draft lasts only for the granted opportunity.

When no draft exists, show a compact launcher. Do not open an empty Draft workspace from an unavailable control. Keep the reason accessible on hover, keyboard focus, and tap. Once a draft exists, show the Live / Draft switch.

## Undo and redo

Undo changes private staged choices. Applying commits those choices to the live game.

- Group undo by player action: an activation, a submitted movement/cargo group, or finishing movement. Do not expose each internal engine answer as a separate undo step.
- Rebuild the preview from the remaining instructions after Undo.
- Redo restores the same intentions if they still match the current game.
- A new edit after Undo replaces the redo branch.
- Apply uses only the active instructions, never the redo branch.
- Keep unsubmitted quantities directly editable through the existing staging controls.

At a randomness, new-information, or unsupported-resolution boundary, keep the last safe preview and show **Preview ends here · Apply to continue in Live**. The player can still undo because the preview has shown no outcome or new information.

Keep this draft history separate from the host's live history controls.

## Draft lifetime

| Event | Draft behavior |
| --- | --- |
| Apply rejected before any live changes | Keep the draft for correction |
| Apply accepted | Freeze the instructions, stop refreshing that preview, and switch to Live |
| Another player needs to respond during application | Wait in Live; resume matching recorded choices after their response |
| Recorded choices successfully committed | Remove the draft and briefly show **Draft applied** |
| Application reaches an unexpected owner choice after partial execution | Stop automation, continue through the live controls, and retire the editable draft |
| Explicit Pass | Discard the unused draft |
| Action phase ends | Discard remaining drafts |
| Ordinary End turn or a strategic/component action | Keep an unused draft for a later tactical action in the same phase |
| Tactical action starts through another tab or direct live input | Retire the corresponding draft |
| Discard draft | Remove it and return to Live |

Pass ends the player's normal actions for the round. End turn only hands play to the next player.

Applying the recorded choices does not mean the whole tactical action has finished. Combat and later choices can still need live input.

Keep internal execution receipts for reconnect and duplicate requests. Do not use them to keep a completed Draft tab alive. Clear the draft after the engine commits its choices, not merely when it selects the last answer. A late update must never bring a removed draft back.

## Compact controls and clear visuals

Use one small toolbar:

```text
[ Live | Draft ]   DRAFT · Movement ready   [Undo] [Redo] [Apply to Live] [⋯]
```

- Give the board frame and draft panels a consistent accent. Keep player and unit colors intact.
- Keep a small **Draft** badge visible when an overlay opens.
- Use draft-specific verbs such as **Stage activation** and **Preview moves**.
- Put **Start over** and **Discard draft** in the overflow menu.
- Put preview assumptions, including optional opponent reactions, in an information popover.
- Keep the workspace switch reachable from overlays without repeating the full status strip.

Use short state labels:

| State | Copy |
| --- | --- |
| Preparing or refreshing | **Updating preview…** |
| Ready while waiting | **Ready · Apply on your turn** |
| Preview boundary | **Continue in Live** |
| A staged selection no longer fits | **Needs review**, with the affected selection marked |
| Preview failure | **Couldn't refresh · Retry** |

During refresh, keep the last safe board visible and disable old controls. On first start, use the live base board until the preview arrives. Retry keeps the staged instructions. Report changed selections without silently replacing them.

Routine preview limits do not need warnings. Show a real problem once, beside its recovery action. Remove repeated explanatory paragraphs and internal replay counts from the normal view.

## Live status and attention

Always use the live game's status in the shared header, even when the board shows a draft. The current Draft session in `web/src/App.tsx` clears `turnStatus`, which causes **Initializing game...**.

Show **Waiting for Alex**, **Your decision** for a reaction, or **Your turn · Preparing tactical action** during own-turn staging.

The live menu waiting for the player's eventual Apply is the draft's starting point. It should not keep pulsing **Switch to Live**. Reserve that alert for a separate live decision, such as a reaction. Keep the alert until the decision resolves, without switching workspaces or stealing focus.

## Implementation

1. Add seat-specific availability, expiration, and discard in `crates/ti4-server/src/session/planning.rs` and the planning protocol. Separate editable drafts from live execution progress.
2. Add an engine starting point for the real current action opportunity. Preserve completed turn-start effects; removing the active-player restriction alone would run those effects again. Revalidate waiting-time drafts against this starting point when the owner's opportunity arrives.
3. Add grouped history and an active cursor in `crates/ti4-server/src/planning/runner.rs`. Add owner-only undo and redo requests. Preserve revision checks and cancel old pipelines when history changes.
4. Extract compact draft controls from `web/src/App.tsx`. Route own-turn Tactical selection into staging, keep live header data separate, and shorten the application summary and overlay controls.
5. Update tests for the new flow and removal rules.

### Checks

- Own-turn drafting does not repeat turn-start effects or change live state before Apply.
- Undo and redo preserve activation, fleet, cargo, and costs; Apply never executes the redo branch.
- Preview boundaries show no random result or new hidden information and still allow Undo.
- Pass clears drafts; ordinary End turn preserves unused drafts; the next round does not revive expired drafts.
- Rejection keeps an unapplied draft; successful application removes it; partial execution returns control to Live.
- Refresh, reconnect, and competing tabs cannot submit stale choices or revive removed drafts.
- Both workspaces show the correct live waiting player. Own-turn staging does not raise a false live-decision alert.
