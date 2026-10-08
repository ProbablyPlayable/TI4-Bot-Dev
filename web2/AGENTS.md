# web2: rules for agents

Read this before you change the UI in `web2/`. These are decisions of the project owner (2026-10-07).

## Consistency

- The UI must feel consistent. A new UX feature must work the same way on every screen where a player can expect it.
- Before you add an interaction (a key, a gesture, a navigation, a kind of control), check each other screen: does it apply there, and does it mean the same thing there?
- If it applies to one screen or a few screens only, do not add it. Use an interaction that the UI already has, or find one that applies everywhere.
- An exception needs a reason that a player can see on the screen, and a line in this file.

## Patterns

These rules hold on every screen. The feature sections below give the specifics and the exceptions.

1. **Controls are where the choice is made.** A control is next to the thing that it changes, not in another place that only has the room. Cases: the payment controls are on the map; the editor is in the row of the viewer in the seat list; the selected technology cell is the control.
2. **Everything that a choice needs is on one screen, with no click.** Prefer one overview to a view for each item. A view that needs a click for each item is the last resort. Case: the seat list shows what every player did.
3. **A staged change shows "now → after" in game values.** Cases: pools "3 → 5", "Trade goods 2 → 5", "Strategy pool 2 → 1".
4. **Colour is never the only carrier of a state.** A state also has a sign, a word or a shape. Cases: ▶ ✓ – ✎ · in the seat list; "+" and the empty outline on tokens; hollow prerequisite marks; "⚠ 1 wasted".
5. **An amount against a cost has three states, always the same.** Short is red and blocks the main button. Exact is green. More than the cost is orange with "⚠", and it is allowed.
6. **One signal for one state.** A state is a pill or a sign. Do not add a frame, a tint and a badge for the same state, and do not repeat it in several places of one screen.
7. **An element that never changes and repeats other content is removed.** Case: the pills for the stages of a strategy card.
8. **An amount changes in steps of one.** A button for the usual target can stand next to the counter ("Pay rest", "Auto-pay"). There is no all-or-nothing button for an amount.
9. **When a screen does not fit: move, restructure, make dense. Do not scroll.** In this order: put a summary into a row that exists on every screen (the footer, the heading, the header of a block); remove what repeats; make secondary rows dense. Only then ask the owner for an exception. Cases: the payment line in the footer; the chosen technologies in the header of the tree; the 24px rows of the seat list.
10. **Live, Draft, History and the event log use the same screen.** Read-only is the same screen with nothing open, not another view.
11. **Hidden information.** A choice of another player is visible when it is resolved, never before. A row of another player is not a control.
12. **Symbols follow the physical game** where the game has a convention. Case: command tokens are triangles, and the fleet pool points up.
13. **Names and long texts.** A name is in a column of fixed width and is cut with "…"; the full name is on hover. The demo data keeps two long player names, 8 players, and the rows that only some factions have (faction technologies). Check every screen against them.

Checklist for a new screen or a changed screen:

- Where does the player make the choice? Are the controls there?
- What must the player see to decide? Is all of it on this screen?
- Does every state have a sign or a word, and only one signal?
- Does it fit at 1920×1080 with 8 players and the long names?
- Does History show the same screen read-only?

## Screen size

- The design target is a viewport of 1920×1080 or larger.
- Narrower screens and mobile clients are a **non-goal**. The game shows too much information for them.
- Do not add breakpoints, container queries, or short variants of labels.
- Screenshots and layout tests use 1920×1080 only.

## Action panel

- The action panel has one fixed width. It does not change with the step.
- There is no control to change the panel width.
- The board for 8 players (61 systems) must stay usable in the space that remains. Improve the board; do not make the panel narrower.

## Text

- The users are experts of the game.
- Text that states a rule or explains the UI is not visible by default. Put it behind hover/click (`Hint` in `src/ui/overlays.tsx`).
- Exception: a list where the player chooses one card (the list of action cards) shows the printed text of each card. The list has the room, and the text is what the player chooses by.
- The action picker itself keeps its rule text behind hover/click. Inline text on every row was tried (2026-10-07) and was too much.
- Visible text states the game state: costs, counts, errors, and who the game waits for.
- The open step must not need vertical scroll at 1920×1080. `e2e/shots.spec.ts` checks this.
- Do not abbreviate labels when there is room. The player table uses full column names.

## Action picker and shortcuts

- There is no separate turn bar. The action picker is the content of the action panel when the viewer has the turn and no action is open.
- The picker has fixed groups in a fixed order: Tactical, Strategic, Component, Trade, Pass. A row that cannot be used stays in its place and shows the reason.
- The picker is one list. The whole row is the control: key, group, name, and the state at the right edge. Rows have no buttons of their own.
- A choice in the picker sends nothing. A tactical action opens as the private draft. A strategic or component action is staged. The main button of the footer sends it.
- After the viewer's action, the panel shows what uses no action, and the footer has "End turn".
- A shortcut key is data: `ActionButtonView.key`. The button shows the key. Enter is the main button of the footer. Esc goes one level back.
- The picker is static: it has the same rows in every turn of a game. Only the number of strategy cards changes it, with the player count. Action cards have one row ("Play an action card"), other components have one row. A second list asks which one, with the keys 1, 2, 3.
- A strategy card has its number as key.
- Browser back is not used for game choices. Esc goes one level back; a draft has undo and redo. Browser back was tried for the picker (2026-10-07) and removed: it could not apply to the other screens.
- Shortcuts do not act in a text field or while a dialog, a menu or a rule text is open. A control that the player reached with Tab keeps Enter.

## Decisions

A decision is any choice that a card, an ability or a rule asks for. Every decision uses the same parts.

- A decision appears where its cause is: as blocks in the open action. The panel does not switch to another screen, and there is no dialog.
- The source is on top: the card, ability or rule that asks, as printed (the `source` block). The heading says what the player must do.
- There are three shapes of choice. The thing that is chosen decides the shape:
  - on the board, when it is on the board (a system, a planet, a place). The panel shows the choice and the limits, not a list of candidates;
  - in the player table, when it is a player. The table already shows the values of each player;
  - in a list, for everything else (answers, rewards, cards). Rows are the controls, with the keys 1, 2, 3 and the effect in game values at the right edge.
- An amount is a counter row. A limit is a gauge above the rows.
- A choice is staged, then sent. A staged choice shows "Selected" and "Not sent". The main button of the footer sends it. Esc clears the choice first, then leaves the action.
- A thing that cannot be chosen stays in view and shows the reason.
- Draft and History use the same blocks.

### Reaction windows

- A reaction window is a block on top of the open action (`interrupt` in the panel frame). The open action and the board show what happened; the block states the trigger in game values.
- The block lists the cards that the viewer can play now, with the printed text and the keys 1, 2, 3. It is the same block inside and outside a battle.
- The main button of the footer is Pass. A card row stages that card; the main button then plays it, and Esc clears it. Enter always does what the main button says.
- "Never offer" is a setting of a card. It is in the Cards reference sheet; the reaction window has a button that opens the sheet. A window that does not open because of the setting leaves a toast.

### Payment

- Every control of an open payment is on the board, in one bar on top of the map: how the payment stands ("Paying 4 / 6 resources", then "2 more" red, "✓ Paid" green or "⚠ 1 wasted" orange), the trade goods, "Auto-pay" and "Clear payment".
- Trade goods are not on the map. The bar has a counter for them, in steps of one, and "Pay rest": it sets the trade goods to what the planets leave, so the payment is exact. It is disabled when the trade goods cannot do that.
- Auto-pay stages the payment with the least waste, with planets before trade goods. The player can change it; nothing is sent.
- The panel has no payment block while a payment is open. The footer has one line for it, left of the note: what pays and the total ("Payment Jord 4 + Vefut 2 · 6 / 6"). It uses no vertical space.
- A recorded or planned payment is a read-only line in the content. The board has no bar for it.

## Strategy cards

All eight cards use one frame: one list of seats. There are no tabs, no seat column and no trail.

- The list has the primary ("P") and then the secondaries in seat order. Each seat is one full-width line: order, symbol, name, state, and what the seat did. All decisions made so far are on one screen, with no click.
- A state has a sign: "▶ Deciding", "· Waits for Blair", "✎ Private draft", "✎ Draft ready", "✓ Resolved", "✓ Followed", "– Passed".
- Only the row of the viewer opens: into the editor, in place, while the viewer has a choice or an open draft there. After it resolves the row closes and shows its result like any other row. A ready draft is closed and says what it will do.
- Other rows are not controls. A choice of another player is visible when it is resolved, never before.
- The same list, with no open row, is the read-only view of a strategy card in the event log.
- The list is dense (24px rows) so that the largest editor, the technology tree with a payment, fits with all eight seats.

- The whole primary is one screen. Every part is staged; "Resolve primary" sends all of it. It is split only where the game reveals hidden information (Politics: the agenda cards are a second screen, sent again).
- A part of a card is a block that uses one of the decision shapes. The board and the player table serve the first part that is not complete.
- A chosen thing is a row with "Change". "Change" clears that part, so it is the open part again. Esc clears the last choice, then leaves the action.
- A part that needs no choice is a value: "Trade goods 2 → 5", "Victory points 6 → 7".
- A secondary is the same editor as its part of the primary, in the row of the viewer: the pill of the heading says "Private draft" or "Your decision". It can be drafted before the seat is reached. It states what it costs: "Strategy pool 2 → 1", or who gave it for free.
- A secondary with a choice: nothing chosen is a pass, and the main button says so. A secondary without a choice (Politics, Trade, Imperial) is a list with "Follow" and "Pass", keys 1 and 2.
- A command pool is a row of triangles, one for each token, with the count ("3 → 5") and a counter. The fleet pool points up, the tactic and strategy pools point down, as on the command sheet. A token that stays is filled, an added token has "+", a removed token is an empty outline with "−".
- Exception to "the source is on top": the printed text of a strategy card is behind hover. There are eight cards and every player knows them.
- Several players are chosen in the player table too (Trade). A row shows what the choice gives that player ("+6 commodities").
- The technology tree is a block in the panel, not a dialog: four colour columns, a row for the unit upgrades, and a row for the faction technologies when the faction has any that are not unit upgrades. A faction technology shows its colour as a square mark before the name. A cell is the control. A filled symbol is a prerequisite that the player has, a hollow one is missing. The printed text of a technology is behind "?".
- Exception to "a chosen thing is a row with Change": in the technology tree the selected cell is the chosen thing and the control. The header of the tree names what is chosen and its price.
- Exception to "keys 1, 2, 3": the cells of the technology tree have no keys. There are too many. Enter and Esc act as everywhere.

## Board

- Payment and planet choices are made on the map only, and the controls of a payment are there too. The footer of the panel names what pays.
- Planets that the open task can use must stand out. The other board content is dimmed during the task.
- System names are flavor. The map does not show them. The inspector shows the name when the player clicks a system.
- A system can have up to three planets. The tile layout must support this.
- A planet that can pay shows resources and influence (`res/inf`). The value that pays is large. The player must see what the payment gives up.
- The inner ring of a system shows who has ships there, in the colour of that seat. A red dashed ring shows that two or more players have ships there.
- Seat symbols are drawn shapes of one size (`SeatShape` in `src/game/context.tsx`). Do not use font glyphs for them: their sizes are not equal.

## Battle table

- The headers of the attacker and the defender have the same lines, so the unit rows start at the same height.
- The simulated odds are in these headers (win % and survivors). They have no card of their own.
- A player can have more than one strategy card (a game of four or fewer players). The player table shows all of them.
