# Game shell integration UX

## Goal

Put the action frame from [Tactical action frame UX](2026-10-06-TACTICAL_ACTION_FRAME_UX.md) into the full game view. The game view must also show the table, the board, each type of action, the references, and past actions.

The click dummy `web/tactical-action-demo.html` shows this shell. It uses fictional data. It shows the most difficult case: eight players and a board with five rings (61 systems). It can show a function that the engine does not have yet. The last section lists what the engine and the server must supply.

This document follows the [UI/UX guidelines](2026-10-04-UI_UX_GUIDELINES.md), section 2 (stable layout) and section 3 (information where players use it).

## Shell layout

```text
Round · phase · status of the live game     [Live | Draft | History]    [Objectives] [Technology] [Cards] [Log]
┌─────────────────────────────────────────────┬──────────────────────────────┐
│ Board: move, zoom, map views                │ Player table: 8 rows         │
│ Task marks on top of the map view           ├──────────────────────────────┤
│                                             │ Action panel                 │
│                                             │ title · stepper · content    │
│ System details · latest result · Log        │ footer with the next button  │
└─────────────────────────────────────────────┴──────────────────────────────┘
```

- The toolbar is always there. It is 48 px high. The board and the right column start below it.
- The board is the large area and has the full height. A board with five rings needs this height.
- The right column has the player table at the top and the action panel below it.
- The stepper is in the action panel, because it belongs to one action.

## What a player sees with no click

The player table has one row for each player and one column for each value. The rows are in seat order and do not move. With eight players the table is approximately 190 px high.

| Column | Content |
| --- | --- |
| Turn | ▶ for the active player. › for the next player in initiative order. |
| Player | Symbol, colour, name, faction. "Spk" for the speaker. "passed" for a player who passed. The row is also the legend for the board and the log. |
| VP | Victory points. |
| SC | Number and short name of the strategy card. A used card has a check mark. |
| R, I | Resources and influence: ready / total. |
| TG, C | Trade goods. Commodities / limit. |
| T·F·S | Command tokens: tactic · fleet · strategy. |
| AC | Action cards in hand. |
| SO | Secret objectives: scored / held. |
| Pl | Number of planets. |

- Each column has a header. The header has the full name as a tooltip.
- The row of the viewer has a different background.
- With eight players each strategy card has an owner. With fewer players a line below the table lists the free cards and their trade goods.
- A button in the header makes the table small. The small table shows only the viewer and the active player.

The toolbar shows the round, the phase, and who the game waits for.

## What is one click away

| Control | Content |
| --- | --- |
| Point at a player row, or focus it | Faction abilities, technologies, leaders. The popover opens on the board side. |
| Click a player row | The full player sheet in a drawer. |
| Objectives, Technology, Cards | A drawer on the left side of the board. |
| Log | The log tree in the same drawer. |
| Click a system | System details in a card at the bottom of the board. |

A drawer does not stop the game. Only one drawer is open. A second click on the same button closes it. The open task keeps its state.

## Board

- The board has 61 systems in the dummy. Each system shows its planets, its anomaly or wormhole, and the ships of each player as symbol and number.
- The player moves the board with a drag. The player changes the zoom with the buttons or with Ctrl and the mouse wheel. A drag does not select a system. The board does not move when the game state changes.
- **Fit board** shows all systems. **Fit task** shows the systems of the open action: the active system and the systems with units and planets of the player.
- The board has two levels of detail. When the board is far away, small text is hidden: system numbers and most system names. Planets, ship marks, anomalies, wormholes, and task marks stay. The names of home systems, Mecatol Rex, the active system, and the system below the pointer also stay. When the player goes nearer, all text comes back.
- The board has five map views: Standard, Res / Inf, Space combat, Ground combat, Tech skips. The player selects the view. A task does not change the view.
- A task puts marks on top of the selected view: routes, pickup counts, planets that can pay, and the highlight that connects a row with its place on the board.
- A planet that the task can use shows its value. When the player selects it, the value stays. A gold ring and a check mark show the selection. Thus the player sees what each selected planet gives, and which selection to undo.

## Action panel

One panel shows each type of action. An action has a type, a title, and a list of steps.

| Action | Steps | Stepper |
| --- | --- | --- |
| Tactical | Activation, Movement, Space combat, Invasion, Production | Shown |
| Strategic | Primary, Secondaries | Shown |
| Component (action card, technology, leader, faction ability) | One step | Not shown. The substeps (target, result) are in the panel head. |
| Pass | No step | Not shown. The player confirms in the action list. |

Rule: the stepper is shown only when the action has two or more steps.

> Superseded for `web2/` (2026-10-07): the panel has one fixed width and there is no width control. See `web2/AGENTS.md`.

The panel has two widths. The narrow width is the default. The panel becomes wide for a step with dice. A button lets the player change the width. In the narrow panel the two sides of the battle table are one below the other.

### Choose an action

When it is the turn of the player and no action is open, the panel shows the action list:

- **Tactical action:** one entry, "Activate a system". The player can activate almost each system, so the panel does not list systems. The entry opens the Activation step with no system selected. The player then clicks a system on the board.
- **Strategic action:** the strategy cards of the player that are not used.
- **Component action:** the cards and abilities that the player can use now.
- **Pass:** with the reason when the player cannot pass.

A choice opens the action in the same panel. Nothing is final until the player uses the primary button of the first step. **Back to actions** goes back to the list.

The Activation step has no list of systems. It has:

- A **Find system** field for the name or the number of a system. This is the keyboard path.
- A card for the selected system: planets, owners, ships, anomaly, wormhole.
- The number of ships of the player that can move there, and from how many systems.
- A message when the system has a command token of the player.

The system details card on the board also has the button "Activate this system" while the action list is open. A click on a system only shows its details. It does not start an action.

When a different player has the turn, the panel shows the action of that player in read-only mode.

### Strategic action and secondaries

- The step **Primary** belongs to the player who uses the card. Other players see its public result.
- The step **Secondaries** shows one row for each other player, in seat order. A row shows one of these states: waits, deciding, followed, passed. With eight players the list has seven rows, so each row is one line.
- The secondary of the viewer is above the list. The player does not scroll to find it.
- A player can prepare a secondary while the primary is not complete. This is a **draft**. The draft has a dashed frame and the label "Private draft · not sent".
- The player marks the draft as ready. The row of the player then shows "Draft ready · resolves after (name)".
- When the seat of the player is reached, the draft resolves automatically. If the draft is not ready, the player decides at that time. The label changes to "Your decision · live".
- The player can change a draft until it resolves.
- A player sees only the own draft. For other players, the row shows a decision only after it is resolved. This keeps the follow or pass decision secret until the rules make it public.

### Three modes, one frame

| Mode | Use | Sign |
| --- | --- | --- |
| Live | The real game. | Blue accent. |
| Draft | A private tactical action that is not applied. | Gold accent, "Private draft". |
| History | A past action from the log, read-only. | A third button in the mode switch and a bar "History · read-only · Back to Live". |

## Past actions

- The log is a tree: round, phase, action, step, decision. See [Hierarchical player-decision log](2026-09-27-HIERARCHICAL_EVENT_LOG_PLAN.md).
- An action row shows the player symbol, the action type, and one summary line. For a tactical action the summary is the result line of each step.
- **Steps** opens the list of steps below the row.
- **Inspect** opens the action in History mode. The player sees the same stepper, the same battle tables, and each die.
- A past action of a different player shows only public data.
- In the real UI the board stays on the present state. It marks the systems of the past action. In the dummy the board shows the result of the past action.

## Why each control was chosen

| Control | Reason |
| --- | --- |
| Player table, always visible | These values are necessary in almost each state of the game. A table shows all players at the same time. A drawer or a tab shows only one. |
| Table and not cells | Eight cells with eleven values each do not fit in one row, and labels repeat in each cell. In a table each label is there one time, and the player compares one value between players in one column. |
| Table above the action panel | The board needs the full height for five rings. The table uses approximately 190 px of the right column. The panel content scrolls. |
| Rows in seat order that do not move | The player finds a player in the same place each time. The turn markers move, the rows do not. |
| Player row as the legend | The symbol and the colour are next to the name. A separate legend is not necessary. |
| Symbol and colour for each player | With eight players some colours are near to each other. The symbol makes the owner clear without colour. |
| Popover on a player row | Faction abilities are necessary often, but they are too long for the table. |
| Board as the large area | Position decides most actions. The board must not become small when an action opens. |
| Two levels of detail on the board | 61 systems with all text are not legible on a small board. The player first needs positions and forces. Names are necessary only near. |
| Fit task | The systems of one action are a small part of the board. One button shows them large. |
| Value stays on a selected planet | A mark that replaces the value hides what the player selected. |
| One entry for the tactical action | A list of all systems is long and has no order that helps. The board is the natural list. |
| Find system field | It gives a keyboard path to each system, and it is fast when the player knows the name. |
| Map views and task marks as two layers | The player keeps the selected view during a task. For example, the player pays with the Res / Inf view open. |
| Action panel on the right with its stepper | The steps belong to one action. The header stays the same for each action type. |
| Stepper only for two or more steps | A stepper with one step gives no information. |
| Two panel widths | Lists are narrow. A battle table needs width. The player can overrule the automatic width. |
| Action list in the panel | The choice of an action and the action use the same place. The player does not look for a menu. |
| Seat-order list for secondaries | In a strict game the secondaries resolve in seat order. The list shows who has answered and who is next. |
| Dashed frame and label for a draft | The player must always know if a selection is sent or not. Shape and text show it, not only colour. |
| Drawers on the left of the board | The panel with the open task stays visible. A reference does not hide the decision. |
| Latest result line on the board | The player sees what changed without opening the log. |
| History as a third mode | A past action uses the same frame. The player does not learn a second view. |

## Mapping to the current UI

| Dummy | Current code | Change |
| --- | --- | --- |
| Shell with three areas | `GameShell.tsx` | Replace the player sheet column by the right column: player table at the top, action panel below it. |
| Player table | `PlayerSheet.tsx`, `TurnStatusBar.tsx` | New component at the top of the right column. Reuse the player data and `playerDisplay()`. The full sheet opens in `DetailPanel.tsx`. |
| Board with views | `Board.tsx`, `MapOverlayToolbar.tsx`, `components/board/*Overlay.tsx` | Keep. Add Ctrl + wheel zoom, Fit task, the two levels of detail, and a separate layer for task marks. |
| Action list | `PendingChoiceModal.tsx` for the action choice | Move into the action panel. One entry for the tactical action. |
| Tactical steps | `SystemActivationBar.tsx`, `TacticalMovementOverlay.tsx`, `CargoLoadingTray.tsx`, `SpaceCombatOverlay.tsx`, `InvasionOverlay.tsx`, `InvasionLandingTray.tsx`, `ProductionBuilderDrawer.tsx`, `PaymentDrawer.tsx` | Each becomes the content of one step in the panel. |
| Strategic and component actions | Generic choices in `PendingChoiceModal.tsx` | One panel flow for each strategy card (guidelines, section 7). |
| Log with Inspect | `EventLog.tsx` | Add the summary line and the Inspect button to an action row. |
| References | `ObjectivesModal.tsx`, `TechnologyModal.tsx`, `CardDetails.tsx` | Show as drawers that do not stop the game. |

Suggested sequence:

1. Shell layout and player table. No change to decisions.
2. Action panel with the stepper for the tactical action. Move the current overlays into steps.
3. Battle table and step results that stay available.
4. Action list, then the strategic and component flows.
5. Log summary and History mode.
6. Draft for secondaries.

## What the engine and server must supply

Status: **Available**, **Partly**, **Missing**, or **Check** (not verified in the code).

| Need | Status | Notes |
| --- | --- | --- |
| Player table values of each player | Partly | The player view has most values. Check the public counts for hidden hands (action cards, secret objectives) and the ready / total sums for resources and influence. |
| Speaker, active player, passed state, next player | Check | Used by `TurnStatusBar.tsx` now. |
| Strategy cards: owner, used state, trade goods on a free card | Check | |
| Action descriptor: type, steps, current step, for each action | Partly | Log events have `action_id`, `action_type`, and `stage`. The current path is in `CurrentLogPath`. The list of steps of an action that is not complete is missing. |
| Strategy card context on secondary choices | Missing | Guidelines, section 7: secondary prompts are generic choices with no card, owner, or step data. |
| List of actions that the player can use, with the reason for each one that is not available | Partly | Legal options exist. Reasons are missing. |
| Systems that the player can activate, and the reason for each system that the player cannot activate | Partly | The legal options give the systems. The reason (command token) is missing. |
| Ships that can reach a system before it is activated | Missing | The Activation step shows this number. The engine supplies move options only after the activation. The Draft runner can answer the activation to get them. |
| Seat order of secondaries and the public state of each player | Missing | Necessary for the seat-order list. |
| Draft of a secondary: private storage, validation, automatic use at the seat of the player, a new check if the state changed | Missing | The planning runner covers tactical drafts only. A draft that is no longer legal must go back to the player as a live decision. |
| Rule for strict seat order | Check | The UI needs to know if the game resolves secondaries in seat order or at the same time. |
| Action record for each `action_id`: result of each step, dice, units before and after, payments | Missing | Build it from events. It needs a public version and a version for the acting player. |
| Summary line for an action row | Missing | The server can supply it, or the browser can build it from the action record. |
| Board state at a past point | Partly | See [State forks and decision replay](2026-10-02-STATE_FORKS_AND_DECISION_REPLAY_PLAN.md). Necessary only for "show the board at that time". |
| Data for the map views | Available | The current overlays use it. |

## Open points

> Superseded for `web2/` (2026-10-07): the design target is 1920×1080 or larger. Smaller screens and phones are a non-goal. See `web2/AGENTS.md`.

1. **Eight players, tested.** The table and the board fit at 1440 × 900 and at 1024 × 768 with no horizontal scroll. At 1024 px the faction name is cut and the full board is in the far level of detail. Test the table with real faction names and with values of two digits in each column.
2. **Small screens.** On a phone the table is above the board and uses approximately 190 px. Decide if the small table is the default there.
3. **Other phases.** The strategy, status, and agenda phases can use the same panel with their own steps. This document does not design them.
4. **A different player's tactical action in History.** The dummy has past tactical actions of the viewer only, because its combat model has fixed sides.
5. **Board in History mode.** Decide if the real board shows the present state with marks, or the past state.
6. **A draft of a secondary that needs the board.** The Leadership secondary needs no board preview. The Warfare or Construction secondary changes the board. Decide if such a draft uses the Draft workspace.
7. **More than two fleets in one system.** The dummy has no system with ships of three players. Test the ship marks for this case.
8. **Seat order with eight players.** The viewer can be the last of seven secondaries. Decide if the panel tells the player when the seat comes near.
