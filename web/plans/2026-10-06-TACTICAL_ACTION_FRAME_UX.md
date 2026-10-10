# Tactical action frame UX

## Goal

Use one frame for a tactical action. The frame shows the five steps: Activation, Movement, Space combat, Invasion, Production. Draft and Live use the same frame and the same content.

The click dummy is the reference for this frame. It uses fictional data and a fixed dice script. It does not connect to the engine.

The dummy can show a function that the engine does not have yet. Each such function is in the section "What the engine and server must supply".

This document adds to [Tactical draft UX](2026-10-04-TACTICAL_DRAFT_UX_PLAN.md) and follows the [UI/UX guidelines](2026-10-04-UI_UX_GUIDELINES.md).

[Game shell integration UX](2026-10-06-GAME_SHELL_INTEGRATION_UX.md) describes how the frame fits into the full game view. In that shell the board is the large area, the frame is a panel on the right, and the stepper is in the panel. The dummy shows eight players and 61 systems.

## Terms

| Term | Meaning |
| --- | --- |
| Frame | The full view of one tactical action. |
| Step | One of the five parts of the action. |
| Current step | The step that the action waits at. |
| Boundary | A point where a Draft stops, because the next result needs dice or hidden information. |
| Origin | A system from which a ship moves. |
| Route | The systems that a ship moves through, from its origin to the active system. |
| Pickup | Fighters or ground forces that a ship loads in a system on its route. |
| Battle table | The table that shows the units, dice, and results of one roll. |

## UX design goals

1. **The content starts near the top.** The toolbar uses 48 px. The board and the right column start below it. The player table is at the top of the right column.
2. **One view for each concept.** Each roll uses the battle table. Each quantity uses the same counter. A player learns a control one time.
3. **The player sees each die.** Each unit type shows its target number, its dice, and its hits. The player can check the result without help.
4. **Rows do not move.** A unit type that is destroyed keeps its row with the count 0. Columns have the same position in each row.
5. **The map is an input.** The map shows the systems that the current step uses. A row and its place on the map are highlighted together.
6. **Show facts. The player decides.** The frame shows where planets and ships are. It does not tell the player which planet is in danger. A danger flag is not reliable, because fast ships can reach almost each planet. A flag on each planet has no value.
7. **A Draft shows no result.** A Draft stops at each boundary. It shows the forces and the chances. It does not show dice or a winner.
8. **One message for one problem.** The message is in the footer. The row with the problem has a mark and the button that corrects it.
9. **No silent change.** If a selection is not legal after an edit, the frame marks the row. The player removes it.
10. **The current step is open.** The player does not click to start it. The earlier steps need a click on Edit, because an edit there checks all later steps again.
11. **The keyboard can do each task.** Text is 12 px or larger. Colour is not the only sign of a status.

## Why each control was chosen

### Frame

| Control | Reason |
| --- | --- |
| Toolbar with status, Live / Draft switch, title, Undo, Redo, Apply, and a menu | One row replaces three bands. The status of the live game stays visible in a Draft. |
| Stepper with one line for each step | The line shows the result of the step ("Sol won · 2 rounds"). The player reads the full action in one row. A locked step shows a lock, not only a colour. |
| Footer that stays at the bottom, with one primary button | The next action is always in the same place. The reason for a disabled button is next to it. |
| Live and Draft only | A completed action is a Live action whose last step is done. A third view repeats the same content. |
| Undo, Redo, and a menu for Start over and Discard draft | Undo is frequent, so it is a button. The two destructive commands are rare, so they are in the menu. |
| "View as" selector (dummy only) | It shows that the defender and a third player use the same frame. It is not a product control. |

### Rolls

| Control | Reason |
| --- | --- |
| Battle table with one row for each unit type | A row for each type shows which unit made which hit. One row of dice for each player hides this. The same table is used for space cannon, barrage, combat rounds, bombardment, and ground combat. |
| Round buttons (Barrage, Round 1, Round 2) | The table stays in its position when the player changes the round. Accordions move the content. |
| Result card above the table | The result is the first thing a player wants after a battle. The rounds are the proof. |
| Odds card before the first roll | The player gets the chance to win and the expected losses. The card names its source and its limits. |
| Sustain and Destroy buttons on the row, then one "Assign hits" button | The player sees the full assignment before it is final. One confirmation prevents a wrong click on one unit. |
| Reaction card with Play and Pass | It shows the card name, the timing, and the effect. The player does not open the hand to decide. |

### Activation

| Control | Reason |
| --- | --- |
| No list of systems. The player clicks a system on the board | The player can activate almost each system. A list of 61 systems has no value. |
| Find system field | A keyboard path to each system. |
| Card for the selected system with the number of ships in range | The player sees what the activation makes possible before the token is spent. |
| Message for a system with a command token of the player | The system stays visible on the board, and the player gets the reason. |

### Movement

| Control | Reason |
| --- | --- |
| One card for each origin, nearest first | Capacity belongs to the ships of one origin. The card keeps ships, cargo, and capacity together. |
| Closed card for an origin with no selection | A far ship can come from many systems. One line for each closed origin keeps the list short. |
| Counter with minus and plus | Quantities are small. The limit is visible, because the plus button goes off at the limit. |
| Move value with its sources ("Move 1 +1 Gravity Drive") | A changed value needs its cause. This is the same pattern as a combat modifier. |
| Route menu on the ship row | The route decides the pickups and the rift rolls. The menu is shown only when two or more routes exist. Each entry names its effect. |
| Route line on the map | The line shows the systems that the ship moves through. The player points at a row to see the route of a ship that is not selected. |
| "Pick up on the way" section in the origin card | A pickup uses the capacity of the same ships. It uses the same counter and the same gauge. |
| "Stays behind" line and "Cannot reach" card | The player sees why a ship is not in the list: move value, command token, anomaly, or enemy ships. |
| Rift roll block | A rift roll is a dice result. It uses the same dice as the battle table and names each ship. In a Draft it is a boundary. |
| Gauges for fleet supply and transport capacity | The two limits are visible before the player commits. |

### Map

| Control | Reason |
| --- | --- |
| Board that the player moves and zooms | The full board is visible by default. The player goes nearer when the units are small. |
| Anomaly and wormhole symbols with a text label | They decide where ships can move. A symbol with text does not depend on colour. |
| Dotted line between two wormholes of the same type | The two systems are adjacent. The line makes this visible. |
| Ship counts for each player on a system | The player sees which enemy ships are near a planet. |
| Row and map highlight together | The player finds the system of a row, and the row of a system, without a search. |

### Invasion and Production

| Control | Reason |
| --- | --- |
| One card for each planet | Defenders, structures, landings, and the result of one planet are together. |
| Unit list with cost and supply | The player sees each unit that can be built, not only the selected units. |
| Four gauges: production, resources, fleet supply, capacity | Each gauge is one rule that can stop the build. |
| Payment rows with a checkbox | A planet is used or not used. The row shows the resources and the influence that the player gives up. |
| Planet on the map as a second checkbox | The player selects planets by their position. This helps the player use planets that are near enemy ships first. |
| Value stays on a selected planet, with a gold ring and a check mark | The player sees what each selected planet gives and which selection to undo. A mark that replaces the value hides this. |
| Placement buttons on the unit row | The choice between a planet and the space area belongs to the unit. |

## What the engine and server must supply

Status: **Available** means the data is there now. **Partly** means some of the data is there. **Missing** means new work.

### Movement

| Need | Status | Notes |
| --- | --- | --- |
| Each ship that can legally reach the active system, from each origin | Available | `movable()` and `movement_options()` in `crates/ti4-engine/src/tactical.rs`. The option has `origin`, `unit`, `damaged`, `capacity`, `gravity_drive`. |
| A move with Gravity Drive as a separate choice | Available | Option id `move_gd\|…`. |
| Fleet supply and transport after each move | Available | `preview_moves()` in `tactical.rs`. |
| Pickup of units on the route, with the rule for command tokens | Available | `CargoWindow::for_ship()` in `crates/ti4-engine/src/transit.rs`. The load option has `pickup_system`, `source`, `capacity_remaining`. |
| Pickup candidates before the player selects the ship | Missing | The engine makes them only after the move is answered. The Draft runner must answer the move to get them, or the engine must supply a preview. |
| Route, move value, distance, and each move modifier with its source, for each move option | Missing | Add these to `preview_moves()`. The UI needs them for the route line and for the text "Move 1 +1 Gravity Drive". |
| More than one legal route, and a choice of route | Missing | `MovementRules::path_from()` in `crates/ti4-engine/src/movement.rs` returns one route, the route with the fewest systems. The player cannot select a longer route to get a pickup or to stay out of a gravity rift. This needs a new decision or a route parameter on the move option. |
| The reason why a ship cannot reach the active system | Missing | The engine supplies only legal options. A function that names the cause (move value, command token, anomaly, enemy ships) is necessary for the "Stays behind" line. |
| Anomalies and wormholes of each system | Available | `BoardTileView.anomalies` and `BoardTileView.wormholes` in `web/src/protocol/types.ts`. |
| Rift roll result for each ship | Partly | The engine sends `SHIP_LOST_TO_GRAVITY_RIFT` for a lost ship. The UI also needs the die of each ship that survives. |
| Rift roll as a Draft boundary | Missing | The Draft runner must stop before a move that leaves a gravity rift, as it stops before combat. |
| A choice of which ships to remove when the fleet is larger than fleet supply | Check | The dummy removes ships automatically. The rules give this choice to the player. |

### Rolls

| Need | Status | Notes |
| --- | --- | --- |
| Each die with its unit type, target, and result, for space combat and barrage | Available | `CombatDieRoll` in `CombatView.dice_rolls` and `barrage_dice`. |
| The same data for space cannon offense, bombardment, space cannon defense, and ground combat | Check | The battle table needs the same shape for each roll. |
| Each modifier with its source ("+1 Morale Boost") | Missing | `CombatDieRoll` has the final target only. |
| Units at the start of each round, and units destroyed or damaged in each round | Partly | `round_start` and `barrage_start` exist for the current round. The frame also shows earlier rounds, so the server must keep them for the action. |
| Chance to win and expected losses before the first roll | Partly | Space combat uses the advisor service (`fetchBattleOdds`). Invasion has `odds_context`. The Draft needs the same answer for a planned fleet. |
| Legal retreat systems, and reaction windows with the card that can be played | Check | The dummy shows them in the frame. They must come as normal decisions. |

### Payment and Production

| Need | Status | Notes |
| --- | --- | --- |
| The system of each planet that can pay | Available | The board view has the planets of each tile. The payment option has the planet id. |
| Resources and influence of each planet, and its exhausted state | Available | Planet data in the board view. |
| Units that can be built, with cost, units for each cost, and units left in supply | Check | `ProductionBuilderDrawer.tsx` shows this now. Confirm that the Draft preview supplies the same data. |

### Frame

| Need | Status | Notes |
| --- | --- | --- |
| Ships that can reach a system before it is activated | Missing | See [Game shell integration UX](2026-10-06-GAME_SHELL_INTEGRATION_UX.md). |
| The result of each completed step of the action, kept until the action ends | Missing | The stepper shows a result line for each step, and the player can open each step again. |
| The boundary type of a Draft (rift roll, space cannon, space combat, bombardment, ground combat) | Partly | The Draft runner stops at a boundary. It must name the type, so the frame can show the correct text and table. |
| Undo and Redo groups, and Apply | Planned | See [Tactical draft UX](2026-10-04-TACTICAL_DRAFT_UX_PLAN.md). |
| Who the action waits for, and for which decision | Available | Live status in the shared header. |

## Open points

1. **Bombardment before landings.** The rules roll bombardment before the player commits ground forces. A Draft with a bombardment unit and a defended planet stops there, so the player cannot plan the landings. Decide if a Draft can plan landings after this boundary.
2. **Third player.** A player who is not in the action sees the same frame in read-only mode. A smaller view can be better.
3. **Pickup in the active system.** The rules allow it. The dummy does not show it.
4. **Many origins.** The dummy has 61 systems, but the units of the player are in nine of them. Test the closed cards with a late-game board.
