web2 covers the tactical action end to end, but almost everything outside it is still missing: the other phases, seven of the eight strategy cards, and most of the generic decision UIs. This is from reading the 239 commits on web/ and comparing web/src against web2's view models, shell and mock; I did not run either app.

Missing features

Phases and flows with no web2 counterpart
- Strategy phase: no strategy card draft. web/ has the card grid with trade goods on each card.
- Status phase: no objective scoring window (score or decline), no command-token redistribution, no hand-limit discard.
- Agenda phase: no ballot, no voting with planets picked on the map, no tallies, riders (predict outcome) or speaker tiebreak.
- Transactions: no trade desk (you offer / you receive, net value, deal categories).
- Strategy cards: only Leadership exists (primary plus secondaries in seat order). Missing are:
  - Diplomacy: system pick
  - Politics: speaker and agenda picks
  - Construction: "1 of 2, second is PDS only"
  - Trade: replenish table
  - Warfare: token recall
  - Technology: research picker
  - Imperial: outcome card
- Component actions: one scripted example (Mining Initiative). web/ has the action-card menu, legendary planet abilities, and leaders/agents.
- Turn end: no End turn, and Pass is a disabled stub.

Generic decision UIs (web2's BlockView has only note, card, payment and draft blocks)
- Offer card: the printed card plus what each answer does, which web/ uses for roughly 15 faction and commander decisions.
- Pickers: system, player (with VP and trade goods), unit, remove-unit (with supply and capacity limits), technology (colour, prerequisites, text) and amount.
- Placement: units from reinforcements, and structures.
- Exploration: the reward card choice.
- Reaction windows outside battles: web2 only has play/pass offers inside the battle table. web/ has a dialog with "What happened / You can now", the card text and a show-on-map link.
- Per-card "Never offer" toggle: missing from both the reaction dialog and the player sheet.
- Auto-pay: web2 pays on the map but has no auto-pay or reset.

Reference sheets (web2 renders all of these as plain bullet lists)
- Objectives: no cards with who scored what, and no VP breakdown per player (public / secret / other, summing to the total).
- Technology: no tree by colour with prerequisites, no cross-player comparison, no tech-skip toggle.
- Player sheet: no action card hand with printed text and no objectives list.
- Log: no card names with hover text and no Copy replay button.

Board
- Planet state: PlanetMarkView has no exhausted/ready outside a payment task, and no traits, legendary marker or attachments. web/'s inspector shows all of these.
- Units: no unit icons or per-type breakdown on tiles, only ship count and strength. Ground forces are a single number.
- Command tokens: only the viewer's token is modelled (TileView.commandToken), not other players'.

Outside the game screen
- Lobby, map picker with preview, nicknames, seats and bots.

Missing UX niceties

- Hotkeys: web/ has letter keys for each turn-bar button, Enter to end the turn, and Space/Enter for pass/play in reaction windows. web2 has only arrow keys on step tabs, Esc on overlays and Enter in the system search.
- Persistent turn bar: in web/, disabled buttons stay in place and say why. web2's picker is a card list that the open action replaces.
- Corner toasts: web/ toasts other players' public actions, merges bursts and has a mute toggle. web2 has one toast slot.
- Auto-resolved decisions: no toast when the engine settles a single-option decision for you.
- Turn sound: no beep with a remembered mute.
- Reaction auto-pass: no countdown with a pin to hold the window open.
- Hover tooltips: web/ has a board tooltip with a system summary and combat-odds tooltips. web2 has only SVG <title> text.
- Live undo/redo: web2's undo exists only inside the draft.
- Paused plan: no banner for "plan stopped at a reaction window, resume the rest". web2's draft stops at dice boundaries, but there is no live resume.
- Dev tooling: web/ has a decision gallery with about 1,500 lines of cases, a scenario launcher, and screenshot folders A–N with the artifact builder. web2 has 16 examples, a primitives gallery and e2e/shots.spec.ts. The capture-*.ts convention in the root CLAUDE.md exists only under web/.

Suggested order

1. Turn bar with End turn, Pass and hotkeys.
2. Offer-card and picker blocks, which unlock most of the long tail of decisions.
3. The remaining strategy cards.
4. Status and agenda phases.
5. Transactions.
6. Richer reference sheets and the toast layer.