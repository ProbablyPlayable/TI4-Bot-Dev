# web2: rules for agents

Read this before you change the UI in `web2/`. These are decisions of the project owner (2026-10-07).

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
- Visible text states the game state: costs, counts, errors, and who the game waits for.
- The open step must not need vertical scroll at 1920×1080. `e2e/shots.spec.ts` checks this.
- Do not abbreviate labels when there is room. The player table uses full column names.

## Board

- Payment and planet choices are made on the map only. The panel shows the total, not a list of planets.
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
