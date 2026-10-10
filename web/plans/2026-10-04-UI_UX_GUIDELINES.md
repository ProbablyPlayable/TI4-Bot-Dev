# UI/UX guidelines for faster multiplayer games

## Goal

Help players spend their time choosing what to do, rather than finding information or working through repeated prompts.

The UI should let players:

- Prepare their next action and strategy-card choices while other players act.
- Reach the information they need in one click.
- See the information that matters to their current choice without clicking.
- Understand what happened, what changed, and which rule or ability caused it.

Use one simple rule when reviewing a screen: **Can the player see what they need, make their choice, and understand the result without losing their place?**

## Review basis

This review uses the current source and browser views on 2026-10-04:

- The board, map views, system inspector, player sheets, card details, technologies, objectives, turn status, event log, and Live/Draft workspaces.
- All 18 frontend decision workflow kinds and the six gallery fallback examples in `/dev/decisions`.
- Desktop and small-screen views of live development scenarios for tactical actions, production, technology, scoring, space combat, and invasion.
- The engine's decision producers, including all eight strategy cards' primary and secondary abilities, the Thunder's Edge Construction and Warfare branches, and decisions that still use the generic UI.
- [TODO.md](../../TODO.md), [web/TODOS.md](../TODOS.md), and the existing plans linked at the end.

The gallery uses synthetic inputs. Opening a gallery view checks its presentation; it does not prove that a whole engine flow works. The guidelines below describe the target experience. The current-state notes describe what the code and browser views show today.

## 1. What feels inconsistent today

The client has useful parts already: map target highlights, several map views, staged movement and payment, combat results, technology text, objective progress, and a private tactical draft. The main problem is how these parts fit together.

| Area                 | Current state                                                                                                                                                                                                                                   | Direction                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Board                | Standard view shows small planet initials and one total unit count. Other views show more useful detail, but players must switch views to understand a fleet.                                                                                   | Keep ownership, ships, ground forces, and important tokens readable in the normal view. Add detail for the current task. |
| Decision layout      | Activation uses a small board bar. Movement and payment use large modal wrappers. Research and scoring use their own large screens. Invasion has another layout.                                                                                | Use one shared frame and place it where the task needs it. Keep the board usable for spatial choices.                    |
| Controls             | Movement can show two “Done moving” buttons. Production gives “produce nothing further” a strong green button. Some views select then confirm; others submit on the first click.                                                                | Give each button one clear job. Use the same selection and confirmation rules everywhere.                                |
| Headers and language | Research says “Close”, scoring says “Minimize”, other decisions use `−`. The turn header can say “YOUR TURN” for a reaction and show “Waiting for player” as the task.                                                                          | Use plain task names and distinguish a turn from a decision during someone else's turn.                                  |
| State access         | Player sheets show useful economy totals, but the local hand makes them tall. Leaders and relics exist in the player data but have no sheet display. Laws and unclaimed strategy cards also exist in the table data but lack a useful overview. | Keep a compact player summary visible and give every state item a direct reference path.                                 |
| Strategy cards       | Drafting shows printed card text. Most later steps, including pool allocation, readying planets, placing structures, and accepting secondaries, still use generic choices.                                                                      | Keep each strategy card in one named workflow from its first choice to its result.                                       |
| Trade                | The proposal view groups complete offers. The answer view mainly shows the prompt and answer buttons. The newer structured diplomacy choices use the generic UI.                                                                                | Show the same two-sided terms to both players, with card effects and final balances.                                     |
| Research and scoring | Both have rich views, but they use separate controls and make local assumptions about costs or eligibility. Secret scoring routes to the same component as the public-objective matrix.                                                         | Show the actual offered choices and prices. Give private secret objectives their own owner-only view.                    |
| Events               | The log groups rounds, actions, and stages. Some events have useful text; others still fall back to “Decision resolved”.                                                                                                                        | Summarize the game action first, with its cause and changes one click away.                                              |
| Small screens        | The invasion view can fill the screen while fixed Players/Events buttons compete with its controls. Large views also make the header and board hard to reach.                                                                                   | Give decisions a fixed header and footer, a scrolling body, and a clear path back to the board.                          |
| Planning             | Live/Draft already preserves separate workspaces. Draft currently clears turn status and can show “Initializing game...”. The tactical draft plan also identifies confusing availability and lifetime rules.                                    | Keep live status visible in both workspaces. Extend the same preparation model to other decisions.                       |

Sources: [GameShell](../src/components/GameShell.tsx), [choiceModel](../src/presentation/choiceModel.ts), [Board](../src/components/Board.tsx), [PlayerSheet](../src/components/PlayerSheet.tsx), and [App](../src/App.tsx).

## 2. Give the game a stable layout

Use three steady areas: **game status, board and task, personal state**. Keep recent results visible near the board.

```text
Round 3 · Action phase · Alex's turn
Your decision: Technology secondary                    [Resume]
[Live | Draft]                      [Players] [Objectives] [Rules & cards]

┌───────────────────────────────┬──────────────────────┐
│                               │ Your state           │
│ Galaxy board                  │ Economy · Tokens     │
│                               │ Hand · Abilities     │
│ Map views stay here           │                      │
│                               │ Current task         │
│                               │ Choice · Cost · Result│
└───────────────────────────────┴──────────────────────┘
Blair recalled a command token from Lodor with Warfare. [Details]
```

This sketch shows the order of information, not fixed panel widths.

- Keep round, phase, active player, and any decision owed by the viewer at the top.
- Show the blocking task: **Waiting for Blair to finish Warfare production**. Show a safe public summary of what the active player is doing.
- Keep the local player's economy, command pools, and main action controls in a predictable place.
- Keep a compact table-wide player summary visible on desktop. Put full hands and long ability text in direct-access panels.
- Put the minimized decision beside the top status, rather than at the bottom of the map.
- Let players inspect the board and references while a task is open. Routine decisions should not blur the whole game.
- Use a side panel for map choices, a small bar for simple responses, and a larger view when players need to compare many items. All three use the same header, controls, and result language.
- Keep pan, zoom, map view, selection, and draft entries through related steps. New information should update the current view rather than rebuild the screen.
- On a small screen, use a bottom sheet with a scrolling body and a visible confirm button. Keep status and Resume reachable. Move panel shortcuts out of the way of decision controls.
- Opening a reference should take one click. Clicking its trigger again should close it. Returning to the task must keep the player's selection.

## 3. Put information where players use it

“Within one click” means one click from the current game view, including an open decision. It should not mean “minimize, open Players, choose a player, choose a tab”. Show the key facts in the task itself; use one click for the full reference.

| Information                                | Show without clicks                                                                                                | One-click detail                                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Turn and waiting state                     | Active player, actual decider, named task, next player in the known order                                          | Turn order, passed players, strategy-card status                                                                        |
| Economy                                    | Ready resources and influence, trade goods, commodities and their limit; the current bill during spending          | Owned planets, both values, ready/exhausted state, payment modifiers                                                    |
| Command tokens                             | Labeled Tactical, Fleet, and Strategy pools; changes while allocating                                              | What each pool does, board tokens, remaining token supply                                                               |
| A system or planet                         | Owner, fleet by player, ground forces, damage, important map tokens; richer detail on a target                     | Full units, unit abilities, planet values, attachments, wormholes, and limits                                           |
| Technologies and faction                   | Player name and faction; relevant movement, production, combat, or research effects beside the choice              | That player's technologies, faction abilities, faction units, mech text, and promissory-note text                       |
| Leaders, relics, fragments, captured units | Relevant usable abilities in the current task; compact status/counts in the local sheet                            | Leader lock/unlock/exhaust/purge state, relic exhaustion, fragment types, captured units and how they can be used       |
| Strategy cards                             | Initiative, owner, ready/used state, current primary/secondary; unclaimed cards and their trade goods in the draft | Exact primary and secondary text for the selected card version                                                          |
| Action cards                               | Card name, timing/trigger, effect; played card and target in a reaction                                            | Full card text and any related card in a cancellation chain                                                             |
| Promissory notes and deals                 | Public face-up notes, owner/holder links, and the full terms of an offer addressed to the viewer                   | Private held notes for their holder, card effects, return conditions, and deal terms                                    |
| Objectives and points                      | VP total; relevant objective text, progress, and cost while scoring                                                | Public objective overview and a breakdown of points from objectives, Imperial/Mecatol, notes, relics, and other effects |
| Agendas and laws                           | Current agenda, full effect text, published votes, voter order, and outcome as it resolves                         | Active laws, elected targets, and their effects                                                                         |
| Recent changes                             | A short result and its cause                                                                                       | Before/after changes, rolls, payments, targets, and the rule or card text                                               |

Always show the player's name with their faction. Use the same player name, color, and marker in the board, controls, and log. Keep the local player first in personal summaries; preserve actual seating and initiative order where order matters.

### Board rules

1. Make the standard board useful. Separate ships in space from forces on planets. A combined “12 units” badge cannot explain what threatens a system.
2. Use larger player markers and unit/count labels. Keep names and shapes available so players do not need to recognize colors alone.
3. Use the same resource and influence icons on planets, player sheets, payment, objectives, and invasion. Add labels where the meaning may be unclear.
4. Show ready/exhausted state with a mark and text as well as color. A selected planet must look different from a planet already exhausted by a confirmed spend.
5. Show dynamic tokens: frontier, Ion Storm, Creuss wormholes, Custodians, and other active map effects. Explain any movement change they cause in the route preview.
6. Keep the chosen map view. Add task highlights over it. For payment, emphasize eligible planets and the needed currency without silently replacing the player's chosen view.
7. Let a map click and its matching list row select the same exact target. If a planet supports several offered actions, ask which action to use rather than picking the first match.
8. Clicking a target stages it. A clearly named button commits it. Keep inspection available on other systems.
9. Show movement origins, destination, route, pickup locations, capacity, and fleet supply together. A route pickup should not disappear from the summary.
10. Keep zoom buttons, add Ctrl + mouse wheel zoom, and support touch pan/zoom. A drag must not also select or commit a system. Keep the camera still during normal updates.

Map combat estimates must say what they include. Keep a rough estimate distinct from a simulation and from an actual roll result. Reuse the same unit data and modifiers across board, production, combat, and reference views.

## 4. Let players prepare together; resolve in game order

The UI should support parallel preparation even when the engine resolves choices one player at a time.

### The preparation flow

1. Let the player open the same controls they will use when their decision arrives.
2. Keep their preparation private. Staged movement, planned votes, payment sources, and follow/pass intentions do not become public game state.
3. Let them edit, undo, and redo their draft. Show projected costs and changes.
4. Mark a complete draft **Ready · Confirm when your decision arrives**.
5. When their real choice arrives, check the draft against the current state and offered choices.
6. Keep valid entries. Mark only changed entries **Needs review**, with a short reason.
7. Let the player confirm the checked draft in one click, or edit it. Resolve it in the required order.

“Ready” means prepared, not spent or resolved. A player preparing something is not the player blocking the live game. The status bar must show both facts correctly.

| Flow                    | Prepare while waiting                                                                             | Recheck before confirming                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Tactical action         | Activation, ships, cargo, route, and the safe preview supported by the planning runner            | Ownership, legal activation, movement, pickup choices, tokens, fleet supply, and capacity          |
| Strategy-card primary   | Its targets, token layout, build list, or research plan where the needed state is already visible | Card availability, new targets, costs, modifiers, and the exact card version                       |
| Strategy-card secondary | Follow/pass, targets, payment, builds, research, and pool allocation                              | Primary effects, eligibility, free follow effects, token cost, and resources                       |
| Strategy-card draft     | A private preference list of cards                                                                | Cards still available and trade goods on them; ask the player before substituting a different card |
| Status                  | Desired scoring choice, spending, and token layout                                                | Current scoring window, requirements, scoring order, point changes, and legal allocation           |
| Agenda                  | A private outcome and vote basket                                                                 | Published votes, current agenda, available influence, riders, and voting order                     |
| Trade                   | Proposed terms and a reply                                                                        | Legal trading window, both players' available holdings, and acceptance of the exact current terms  |
| Combat                  | Preferences for known hits, sustain choices, and retreat destinations                             | Current hits, surviving units, reactions, and the current battle stage                             |

Preparation must respect dependencies:

- Trade followers can prepare, but their final cost depends on the primary player's replenishment choices.
- A second technology can depend on the first. Show that dependency and check the fresh research offer after the first resolves.
- A casualty plan can change after sustain damage, Direct Hit, or another reaction. Pause it at that boundary.
- Politics draws, secret objectives, exploration, and rolls can reveal new information. Stop the preview before the reveal. Continue in Live when it happens.
- Voting and scoring still follow the game's order. Preparing a vote does not cast it early; preparing a score does not claim the point early.

The existing tactical draft is the first working part of this model. Follow the [tactical draft UX plan](2026-10-04-TACTICAL_DRAFT_UX_PLAN.md) for its availability, grouped undo, apply, and lifetime rules. Strategy, status, agenda, production planning, and shared readiness need further server support. A browser-only draft must not act as permission to submit an out-of-turn choice.

### Attention and automation

- Use **Your turn** for an action opportunity and **Your decision** for a reaction or secondary during someone else's turn.
- Keep live status visible while the player uses Draft. A real live decision adds a clear one-click return to Live; it does not switch workspaces or steal focus.
- Keep the notice until the decision resolves. Send one notification when a new obligation arrives, not one for every internal payment step.
- Offer a turn/decision sound with a per-player mute setting. Respect reduced motion.
- Let players choose automatic passing for named optional reaction windows. Show the setting, its scope, and **Pause auto-pass**. Minimize does not mean Pass.
- Use a countdown only when a real timer or an enabled auto-pass setting governs it. Do not invent a deadline.
- Record automatic passes and forced results in a short summary. Keep meaningful choices manual unless the player has explicitly prepared and authorized them.
- Audit single-option decisions by subtype and cause. Forced draft picks and forced bookkeeping may resolve automatically. A sole optional purchase, a choice that reveals information, or a required random step needs its own rule; option count alone is not enough.
- The bluffing TODO needs engine support for consistent reaction windows. The UI should show the trigger, rather than imply that a pause proves someone holds a card.

## 5. Use the same decision rules everywhere

### Every decision answers six questions

1. **What am I choosing?** “Ready two planets”, not an internal subtype.
2. **Why now?** “Diplomacy secondary · Alex played Diplomacy”.
3. **What can I use?** Legal targets, available units, planets, cards, and limits.
4. **What does it cost?** Tokens, resources, exhaustion, discarded units, or purged cards.
5. **What will change?** A short result preview and any follow-up step.
6. **What has already happened?** Confirmed progress beside the remaining draft.

Show these facts in the decision, not only in tooltips or the event log. Put the exact rule/card text one click away. Show extra text automatically when it changes how the player should choose.

### Shared controls

- Use one header: task title, source, short instruction, useful progress, and `−` to minimize.
- Use `✕` to close a reference. Escape dismisses the top reference or minimizes the task; it never spends, passes, or resets a draft.
- Use a radio/card choice for one item, toggles for planets/cards used once, and `− count +` for repeatable units or quantities.
- Show **available**, **staged**, and **confirmed** separately. Do not call a local selection “paid” or “moved”.
- Keep one primary action in a steady footer. Name its effect: **Move fleet**, **Pay 6 resources**, **Ready planets**, **Cast 8 votes For**, or **Confirm token layout**.
- Use **Reset selection** to clear local edits. Use **Discard draft** for the whole private plan. Use **Undo** only for a real history action.
- Keep Pass, Decline, Finish, and End turn distinct. Pass ends normal actions for the round; End turn hands play to the next player.
- Show a finish/decline action only when the server offers it. Remove duplicate finish buttons.
- Stage meaningful choices without selecting the first offered item as the player's intention. Editable suggestions can help with landings or payment, but label them as suggestions and show their effects.
- Show why a control is disabled beside the relevant control or on focus/tap. Do not make players guess whether the reason is cost, stock, timing, or connection.
- Support keyboard selection and clear focus. Shortcuts act only in the active task and must not override typing or another focused button. Enter should confirm the chosen action, not play the first reaction card by default.

### Costs and limits

- Take prices, quantities, targets, and legality from current server data. Use card text for reference, not as a second rules engine in the browser.
- Use the same payment control for production, technology, command-token purchases, scoring, Custodians, and ability costs.
- Show the purpose of the payment. “Pay 4 resources for Gravity Drive” is more useful than “Pay resources”.
- Show the bill, paid amount, selected sources, remaining amount, and the result for each source. Show both planet values so players can see the other value they give up.
- Explain overpayment correctly: wasted value or credit for this named purchase sequence, with its limit. Do not promise reusable credit when the server has not provided it.
- Let players choose trade goods or planets and review suggested payment. Avoid exhausting an extra planet when the chosen payment already covers the bill.
- Show stock, production capacity, fleet supply, and transport capacity as separate limits. Group identical units only when their type, owner, location, damage, and other relevant states match.
- Show unknown information as unknown. Do not use option count as stock or silently invent a capacity, price, or number of hits.
- Token allocation uses three labeled pip bars with plus/minus controls and an **Unassigned** count. Keep the total correct and require a complete legal layout. For redistribution, match the final layout to an actual offered combination; enforce the engine's limits rather than a new browser rule.

### Submission and recovery

One UI confirmation can cover several engine choices. Keep the whole task visible as those choices resolve.

- Freeze submitted entries while they apply. Avoid repeated modals for each unit, planet, or token.
- Mark confirmed changes from the server. Keep the unconfirmed remainder editable when a sequence stops.
- Check the next offer before each queued step. Preserve all relevant details, including damage, source planet, carrier, and route pickup.
- Pause for another player's reaction or a new choice. Resume only the still-valid choices the player authorized.
- Show partial completion plainly: **Moved the carrier. The cruiser can no longer reach Lodor. Review the remaining move.**
- Show errors beside their recovery action. Keep useful drafts through rejection or reconnect; disable stale submit controls until current state arrives.
- Keep draft undo separate from the host's table-wide history controls. Add player undo for reversible live actions only where the engine allows it and no randomness or new information has occurred.

## 6. Cover every current frontend decision type

The table covers all 18 kinds in [choiceModel](../src/presentation/choiceModel.ts). “Current UI” describes the normal route. Combat and invasion can keep nested decisions inside their active view.

| Decision kind                | Current UI                                                          | Required experience                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| System activation            | `SystemActivationBar`                                               | Select a legal system on the board. Show its name, contents, activation cost, and relevant effects. Confirm activation once.                                                          |
| Tactical movement            | `TacticalMovementOverlay`, with a modal wrapper                     | Keep origins, destination, route, ships, cargo, fleet supply, and capacity together beside a usable map. Preserve the draft through cargo and reactions.                              |
| Cargo loading                | Movement view while its plan runs; otherwise `CargoLoadingTray`     | Show the carrier, pickup system/planet, available fighters/ground forces, and free slots. Keep staged cargo tied to its carrier and route.                                            |
| Tactical invasion / landings | `InvasionLandingTray`; `InvasionOverlay` when invasion state exists | Distribute forces across planets in one view. Show defenders, planet values, exploration context, and forces left in space. Offer an editable legal starting distribution.            |
| Payment                      | `PaymentDrawer`, with a modal wrapper                               | Show the named purchase, full bill, confirmed spending, selected sources, credit/waste, and remaining balance. Allow map and list planet selection.                                   |
| Production / placement       | `ProductionBuilderDrawer`                                           | Build one cart with unit text, costs, stock, production capacity, fleet supply, and transport capacity. Keep payment and placement in the same workflow. Select placement on the map. |
| Sustain damage               | `SpaceCombatOverlay`                                                | Show incoming hits, eligible undamaged units, damage already taken, and the consequence of sustaining. Keep the following reaction window in context.                                 |
| Assign casualties            | `SpaceCombatOverlay`                                                | Show actual hits and actual units, including damaged copies. Let players choose legal losses. Batch only where fresh offers support it; keep rows steady as units disappear.          |
| Retreat                      | `SpaceCombatOverlay`                                                | Distinguish announcing a retreat from choosing its destination. Show when the retreat happens, surviving units, legal destinations, and costs on the map.                             |
| Agenda outcome               | `AgendaBallotModal`                                                 | Keep the agenda text, legal outcomes, published tallies, voting order, and relevant laws/riders visible. Give a speaker tiebreak its own clear task.                                  |
| Agenda vote spending         | `AgendaBallotModal`                                                 | Keep the selected outcome visible. Select ready planets on map or list; show confirmed and staged votes. Cast the named number of votes once. Offer only legal vote sources.          |
| Trade proposal               | `TradeDeskModal`                                                    | Show Give and Receive sides, player names, holdings, card effects, and final balances. Match the final terms to a legal offer.                                                        |
| Trade answer                 | `TradeDeskModal`                                                    | Show the complete incoming terms before Accept/Refuse. Keep the same terms when countering, if Counter is offered.                                                                    |
| Action-card reaction         | `ReactionStatusBar`, currently often inside a modal wrapper         | Use a small response panel. Show the triggering card/ability, full effect, target, available responses, and Pass. Keep cancellation chains clear.                                     |
| Objective scoring            | `ObjectivesModal`                                                   | Show requirements, current progress, price, and points after scoring. Use an owner-only secret-objective list for secret scoring; do not replace it with the revealed public matrix.  |
| Strategy-card draft          | Strategy layout in `PendingChoiceModal`                             | Show initiative, full primary/secondary text, unclaimed trade goods, and current picks. Keep waiting players' preferences private.                                                    |
| Technology research          | `TechnologyModal`                                                   | Show the correct faction's technologies, current research step, actual price, prerequisites, skips, modifiers, and exhaustion effects. Check each later research offer separately.    |
| Generic selection            | `PendingChoiceModal`                                                | Use the shared frame, readable options, useful source/target detail, and real constraints. Keep all offered choices reachable, including ones a richer view cannot show yet.          |

### Combat and invasion need a full result

- Keep space cannon, barrage, bombardment, ground combat, sustain, casualties, and retreat clearly named. Do not label every unit-loss decision “Space Combat”.
- Show each side's rolls, hit targets, modifiers, hits, canceled hits, damage, and losses. Use the actual rolled values.
- Show the rule or ability that changes a roll, blocks bombardment, adds a gun, or causes another loss.
- Keep the result visible as the next step opens. After the battle, show winner, survivors, destroyed units, retreats, control changes, and exploration or scoring effects.
- Give involved players the full live controls. Give others a compact public result and a one-click battle view; let them keep planning.
- Do not open a full invasion screen for an uninvolved player during an uncontested landing. If that player receives a real reaction, show the reaction and its context.
- Keep any simulated odds optional and clearly labeled. Missing simulator data must not block combat decisions.

## 7. Treat each strategy card as one workflow

Show **card name · Primary/Secondary · active step** throughout the flow. Keep targets, costs, and progress together as internal choices arrive.

All secondary entry prompts currently come from `strategy.rs` as ordinary choices without typed strategy-card context. They fall back to the generic UI. Add the card, primary owner, participant, cost, and step data so the browser can present the right workflow and waiting summary.

Use the active game's card ID and content version. Show the chosen expansion/errata text and verify that the engine effect matches it. Printed names alone cannot distinguish the Construction and Warfare variants.

The amounts below describe the ordinary card branches currently in the engine. Show the actual price after any faction, leader, note, technology, or law changes it.

### Primary abilities

| Card         | Current steps and UI                                                                                                                         | Target flow and automatic context                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Leadership   | Gain three tokens through repeated generic pool choices; repeated yes/no purchases; influence payment; another pool choice for each purchase | One token plan: free grant, number to buy, total influence, payment sources, final pools, and remaining token supply. Confirm the plan once; show what was actually gained.                                                                                        |
| Diplomacy    | Generic system choice, then up to two repeated generic `ready_planet` choices                                                                | Choose the protected system on the map, then choose exhausted planets in the same panel. Show other players' added tokens, planet values, and the economy before/after.                                                                                            |
| Politics     | Generic speaker choice, draw two cards, then separate generic top/bottom agenda choices                                                      | Choose the next speaker with player names. Show drawn cards privately when drawn. Show the two looked-at agendas' full text and deck placement/order privately. Keep the speaker result public.                                                                    |
| Construction | Generic structure choice, then another placement restricted to PDS in the ordinary branch                                                    | Select structures and legal planets on the map in one placement plan. Show existing structures, unit stock, and the first/second placement rules. Keep completed placements visible.                                                                               |
| Trade        | Gain three trade goods, replenish self, then repeated generic choices of other players to replenish                                          | One Trade panel: own gains, eligible players, current/max commodities, selected free replenishments, and related Trade Agreements. Show the final selections before followers confirm. Keep exchanges reachable from the same context.                             |
| Warfare      | Generic recall target, generic pool gain, generic final redistribution                                                                       | Click the command token's system on the map. Show which system becomes usable again. Allocate the recalled token and edit final pools with the shared pip controls.                                                                                                |
| Technology   | Research view for one free technology, then an optional paid technology at six resources; the paid helper marks its source as secondary      | One named primary flow with first/second slots, ordered prerequisites, real offered prices, skips, payment, and discounts. Keep the parent workflow clear even when the helper's source label is incomplete. Stop or continue after the first research as offered. |
| Imperial     | Objective scoring view, then an automatic Mecatol point or secret-objective draw, possibly followed by hand-limit return                     | Show the score choice, requirements/payment, and resulting points. Show which Mecatol/secret branch applies before confirming. Show drawn/returned secret cards only to their owner. Finish with the score and draw summary.                                       |

### Secondary abilities

| Card         | Current steps and UI                                                                                                | Target flow and automatic context                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leadership   | Generic yes/no influence purchase entry; payment and repeated generic pool/purchase choices; no strategy-token cost | Prepare quantity, full influence payment, and pool allocation together. Show no strategy-token fee and any credit that stays within this purchase sequence.                                                                            |
| Diplomacy    | Generic follow prompt, then repeated generic ready-planet choices                                                   | Prepare the planets and show their values/gain beside the strategy-token cost. Confirm the complete secondary once. Show a brief skip reason when no planet can be readied.                                                            |
| Politics     | Generic follow prompt, draw two action cards, then discard if over the hand limit                                   | Show the cost and hand count before Follow. After the real draw, show the new cards and any required discard together, with their timing and text.                                                                                     |
| Construction | Generic follow prompt, then generic structure placement                                                             | Prepare the unit and legal planet on the map. Show stock, existing structures, token cost, and any system-token effect required by the selected card's rules.                                                                          |
| Trade        | Generic follow prompt; automatic commodity replenishment                                                            | Show current/max commodities, the gain, whether replenishment is already free, the token cost, and any note that changes who receives it. Confirm only after the primary's selections settle.                                          |
| Warfare      | Generic follow prompt, then home production, payment, and placement views                                           | Prepare the whole home-system build cart. Show the allowed production source, ships already there, supply/capacity, stock, resource payment, and strategy-token cost together.                                                         |
| Technology   | Generic follow prompt, research view, and automatically chosen resource payment in the paid helper                  | Prepare the research and payment together. Show the ordinary four-resource fee plus strategy-token cost, then actual discounts or substituted abilities. Do not charge Follow before the player sees what they can research and spend. |
| Imperial     | Generic follow prompt, draw one secret objective, then return a secret if over the limit                            | Show the cost and hand count before Follow. Stop preparation before the unknown draw. Show the real new objective and return choice together when it arrives.                                                                          |

### Variants and extra effects

- **Thunder's Edge Construction:** the engine first asks for a structure or production in a chosen system, then places another structure. Keep both branches in the Construction workflow; use the shared map picker or build cart as needed. Its secondary uses structure placement. Show the exact selected card's text.
- **Thunder's Edge Warfare:** the primary offers a free tactical action, classified as activation because its options have kind `activate`. Label the free cost and keep the parent Warfare workflow through the tactical action. The current secondary goes through home production.
- **Faction and leader changes:** show free secondaries, substituted primaries, Specialist Compounds, Doctor Sucaban, and other changes before confirmation. A substitute must show its actual steps and price, rather than the ordinary secondary description.
- **Related effects:** Peace Accords, production after structure placement, hand-limit returns, and strategy-card swaps belong to the same visible workflow when they follow from it. Keep their individual causes clear.
- **Overrule and Strategize:** let players inspect the chosen card's relevant half and cost while choosing which ability to perform. Reuse the corresponding workflow without implying that ownership moved.

Followers should prepare together. Show a compact progress row with the primary step and current resolver. Do not reveal a player's private draft or follow/pass intention before the rules make it public. Explain skipped participants without making them confirm a useless prompt.

Sources: [strategy_cards.rs](../../crates/ti4-engine/src/strategy_cards.rs), [strategy.rs](../../crates/ti4-engine/src/strategy.rs), and the strategy/faction flow in [game.rs](../../crates/ti4-engine/src/game.rs).

## 8. Give missing and fallback decisions a proper home

The 18 frontend kinds do not cover every engine subtype. Many related decisions still fall back to generic selection. Some have no context; others use a content-generated name. Some reach a dedicated view only through their option kind or an active battle. Combat and invasion also replace the normal route while their view is active.

Use shared task controls for these families. A rare card does not need a new layout, but it still needs a clear source, cost, target, and result.

| Other decision family / examples                                                                                                                                                                                                             | Required presentation                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `action_menu`, `end_turn`, `mid_action_pause`                                                                                                                                                                                                | A compact action panel. Name the remaining strategy card, show usable components and free actions, and distinguish End turn from Pass. Show an optional short turn summary.                                   |
| Secondary entry choices with missing context                                                                                                                                                                                                 | Card-specific follow/pass controls with the real cost and prepared details. Add typed parent workflow data.                                                                                                   |
| `gain_command_token`, `buy_token_with_influence`, `warfare_redistribute_tokens`, `status_redistribute_tokens`, `predictive_intelligence_redistribute`                                                                                        | The shared pool allocator and purchase/payment summary, with the source and final counts. Avoid a long list of token triples.                                                                                 |
| `diplomacy_choose_system`, `ready_planet`, `place_structure`, `warfare_recall_token`, `construction_choose_ability`                                                                                                                          | Map selection inside the named strategy workflow. Show ready/exhausted planets, unit stock, command tokens, and before/after effects.                                                                         |
| `politics_choose_speaker`, `politics_place_agenda`, `trade_choose_replenish`                                                                                                                                                                 | Named player selection, private full agenda text/deck order, and the combined Trade panel respectively.                                                                                                       |
| `bombardment_target`, `assign_ground_casualty`, `start_next_ground_combat`, `fight_ground_combat_round`, `deploy_mech`                                                                                                                       | Shared invasion/combat controls with the actual planet, forces, hits, cost, and next step. Keep automatic bombardment and roll results visible.                                                               |
| `remove_custodians`                                                                                                                                                                                                                          | Mecatol's Custodians context, influence cost, available payment, and control/point result in one view. Do not confuse the yes/no entry choice with the following payment.                                     |
| Fleet-supply and capacity removal choices without context                                                                                                                                                                                    | A named unit-removal task showing the system, exceeded limit, units, and why removal is required. Explain if losing a carrier creates a later capacity problem.                                               |
| `reroll_die`, `jolnar_commander_reroll`, Crown of Thalnos rerolls, `munitions_reserves_reroll`, `heart_ixth_die_adjust`, `wrath_of_kenara_bump`, `war_funding`, `assault_cannon_destroy`                                                     | The current combat view with the die/unit, modifier, cost, and legal result. Keep card losses distinct from ordinary incoming hits.                                                                           |
| `reaction_when_*`, `reaction_after_*`, `play_reaction_*`, `instinct_training_cancel`, `l1z1x_agent_swap`                                                                                                                                     | One shared reaction flow for cards, leaders, technologies, and other abilities. Route by the actual source/window; the option-count heuristic should not change the layout.                                   |
| `discard_over_hand_limit`, `return_over_secret_hand_limit`, expedition discards                                                                                                                                                              | A private hand view with full text, new cards marked, the required count, and selected losses. Let players stage repeated discards together while checking each fresh offer.                                  |
| Structured diplomacy: `diplomacy_offer_item`, `diplomacy_ask_item`, `diplomacy_amount`, `diplomacy_review`, `diplomacy_response`, `diplomacy_agenda_talks`                                                                                   | Reuse the two-sided exchange view. Keep Give/Receive, quantities, promises, conditions, review, and accept/counter visible through the whole negotiation. Separate negotiation text from committed transfers. |
| `predict_agenda_outcome`, `agenda_elect_tiebreak`, `confusing_legal_text_elect`, `redistribution_choose_settler`, `defense_act_choose_pds`, `offer_discard_law`                                                                              | Keep the agenda or law text and current outcome visible. Use player/map/unit pickers for the target and show the effect of the choice.                                                                        |
| Exploration `{card}_choose_reward`, including Ion Storm and commodity/resource rewards                                                                                                                                                       | Show the revealed exploration card, exact reward/cost, planet or token affected, and resulting state. Use a small contextual panel for uncontested exploration.                                               |
| `psychoarchaeology_exhaust_specialty`, `transit_diodes_redeploy`, `chaos_mapping_choose_system`, `bio_stims_ready`, `exhaust_for_production_discount`, `scanlink_explore`, `spatial_conduit_link`                                            | Reuse planet, unit, route, readying, and production controls. Show the technology text, exhaustion cost, and changed action.                                                                                  |
| `specialist_compounds_choose_planet`, `specialist_compounds_choose_technology`, `doctor_sucaban_exhaust`, `doctor_sucaban_remove_infantry`                                                                                                   | Keep the research plan open. Show the specialty, allowed color, infantry locations, agent owner, and resulting price. Separate the agent owner's choice from the researcher's choice.                         |
| `orbital_drop_choose_planet`, `orbital_drop_deploy_mech`, `production_biomes_choose_player`, `peace_accords_annex`, `nullification_field_end_turn`, `quantum_datahub_swap`                                                                   | A named faction-ability task with its full effect and cost. Reuse map/player/card controls and show the action or ownership change.                                                                           |
| Leader choices, including `leader_xxchaagent_*`, `leader_hacanagent_branch`, `leader_hacanhero_free_production`, `leader_xxchahero_te_*`, `leader_l1z1xhero_destination`, `leader_jolnarhero_swap`                                           | Show the leader, owner, status, cost/use, and legal targets. Use readying, placement, production, movement, and technology controls rather than leader-specific layouts.                                      |
| Relic choices: `{relic}_choose_technology`, `codex_take_action_card`, `titan_prototype_choose_builder`, `stellar_converter_choose_target`, `crown_of_emphidia_choose_planet`, `dominus_orb_purge_to_move`, `neuraloop_choose_relic_to_purge` | Show the relic and exhaust/purge effect. Use research, card, player, or map pickers. Keep destructive effects and follow-up production/movement clear.                                                        |
| `legendary_*` choices: end-of-turn/pass use, placement, salvage, unit conversion, research, and hand choices                                                                                                                                 | Show the legendary planet/card, use state, target, and result. Reuse the matching shared controls and preserve the turn-ending context.                                                                       |
| Action-card target/effect choices: `{card}_pick_{kind}`, Public Disgrace, Reparations, Crash Landing, Skilled Retreat, Silence, Ghost Squad, Exchange Program, Fire Team, and special casualties                                             | Show the played card's trigger and effect. Reuse system, planet, player, unit, card, or quantity controls based on the offered target. Keep later choices under the played card.                              |
| Promissory-note use choices named by note alias                                                                                                                                                                                              | Show note owner, holder, full text, cost, target, and return condition. Show public face-up changes when they happen; keep private held notes private.                                                        |
| `expedition_place_system`, `expedition_placement_tiebreak`, `fracture_choose_ingress_system`, `entropic_scar_gain_faction_technology`                                                                                                        | Show the expansion effect and use map, player, or technology selection as appropriate. State whether this is gaining a technology or researching one.                                                         |
| Unknown subtype, missing context, bounded selection, empty options, or missing finish                                                                                                                                                        | Keep known offered options usable. Show a specific empty/error state and recovery path when needed. Never fabricate a finish action or guess a rule from an opaque ID.                                        |

These families come from the engine's strategy, tactical, transit, fleet, combat, invasion, voting, diplomacy, action-card, exploration, technology, faction, leader, relic, legendary, and expansion modules.

Keep a coverage list that records each real subtype or generated family, its source, renderer, required data, and a representative engine-shaped example. Mark a deliberate generic choice separately from a missing richer view. Keep no-context choices in that list until their producers supply enough data.

## 9. Explain what happened and why

Use the same result text in the task, recent-results strip, and log.

**Result pattern:** player + action + target + important change + cause.

- **Alex readied Jord and Rigel III with Diplomacy. Ready resources: 2 → 7.**
- **Blair bought two command tokens with Leadership. Spent 6 influence; added one Tactical and one Strategy token.**
- **Alex researched Gravity Drive with Technology. Spent 4 resources and one Strategy token.**
- **Blair lost a dreadnought to Direct Hit after sustaining damage.**
- **The council elected Alex. The law now limits Alex's fleet pool.**

Only show these amounts and effects when the server confirms them. Use a shorter safe public summary when the detail is private.

### Result display

- Show a short result automatically after an action, strategy workflow, battle, vote, score, or meaningful automatic effect.
- Group internal choices under that result. A six-unit move should read as one move, with individual steps available in Details.
- Keep the latest combat/ground result visible through the next decision and after the final fight. An optional end-of-turn summary can collect the turn's changes.
- Link card, technology, law, player, system, and planet names to their reference. Show card text on hover/focus as a shortcut; keep click/tap support.
- Explain causes from recorded events and rule/effect data. A state difference can show a balance change, but cannot reliably explain why it changed.
- Keep automatic changes visible: readying, token gains, free replenishment, note returns, leader unlocks, scoring, and laws. They matter even when no choice was asked.
- Keep logs readable while they update. Follow new events only if the reader is already at the latest event. Otherwise show **New events** without moving their scroll position.
- Use stable event/group keys. Preserve open groups and position across ordinary updates to stop flashing and repeated rows.
- Put versions, nonces, raw subtype names, and internal replay counts in developer details. Normal log entries should describe play.

## 10. Use a small, shared visual style

- Use the existing dark canvas and shared color variables as the base. Use one panel background, border style, spacing scale, and header/footer pattern.
- Use neutral panel borders. Reserve accent for selection/action, green for a completed or valid state, amber for attention, and red for a real error or destructive effect.
- Keep player colors for identity and ownership. Keep technology colors for technology tracks. Add labels so those meanings do not depend on color alone.
- Fade used strategy cards and exhausted abilities, and label their state. Keep their names and reference text readable.
- Avoid a separate color theme for every workflow. A green production frame and a purple trade frame add rules the player must learn without helping the choice.
- Use one icon set for resources, influence, units, tokens, cards, and status. Avoid mixing tiny SVG symbols, emoji, and plain letter codes for the same thing.
- Keep normal text comfortably readable. Aim for 14–16 px body/control text, 18–20 px task titles, and at least 12 px secondary labels. Give dense views an explicit compact mode rather than shrinking everything.
- Use steady rows and columns for comparisons. Align unit quantities, costs, and before/after values.
- Give touch controls room: about 44 px targets for common actions. Keep a clear keyboard focus mark, accessible names, and readable contrast.
- Animate confirmed changes briefly and optionally. Never delay the next legal input for an animation. Keep repeated updates from pulsing the whole screen.

## 11. Supply the state the UI needs

Some work needs display changes; some needs new public or seat-private data. Keep that distinction clear in implementation plans.

| State/data gap                                                                                | Current foothold                                                                    | Needed change                                                                                                           |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Leaders, relics, used strategy cards, laws, unclaimed cards and their goods                   | Existing `PlayerView` / `TableView` fields                                          | Render the status and full reference text consistently.                                                                 |
| Private/public promissory notes, fragments, captured units, dynamic map tokens, point sources | The game models hold broader state than the current web projection                  | Add the needed public or owner-only view fields. Do not send all private state and hide it only with CSS.               |
| Current agenda, full ballot, voter order, effects                                             | Engine voting window plus partial tally payloads                                    | Project a shared agenda view so waiting players can plan and understand the result.                                     |
| Strategy-card workflow, remaining grants, follow cost, parent action, and step                | Card sources exist on some choices; secondary entry and shared helpers lose context | Keep parent workflow data through all steps, including no-context prompts and substituted abilities.                    |
| Unit stats, stock, capacity, and discounts                                                    | Option payloads, content catalog, board, and player technologies                    | Use one consistent presentation source; supply effective values from the engine where browser estimates are incomplete. |
| Simultaneous readiness and draft checks                                                       | Seat-private tactical planning messages                                             | Extend preparation to the other workflows with explicit dependency checks and ordered application.                      |
| Meaningful results and causes                                                                 | Hierarchical log and partial choice details                                         | Add structured result records for choices and automatic effects, including safe public summaries and private details.   |
| Reversible player undo                                                                        | Host history controls and private draft replay                                      | Add rule-aware player undo boundaries and use the same clear history controls.                                          |

The [web view types](../src/protocol/types.ts) show which fields are already available. The generic renderer cannot create missing facts. Show a limited but honest view until the projection supports them.

## 12. Turn TODO.md into work in this order

### First: make current play clear and dependable

- Fix wrong faction technology displays, payment calculations/auto-spending, stale scoring eligibility, route pickup, and the reported Diplomacy/Hacan failures. These problems change the choices players think they are making.
- Fix flashing, duplicate log keys, scroll jumps, hidden errors, and overlapping small-screen controls.
- Share decision headers, minimize/Resume, footers, and wording. Remove duplicate controls and “Play play” labels.
- Show the current task and blocking player correctly in Live and Draft.
- Add meaningful results for the most common actions, payments, and token purchases.

### Next: put necessary state and choices in reach

- Improve normal board units, player markers, map selection, camera/view retention, and balanced predefined map display.
- Add the local state shelf and compact player summaries, with names and labeled token pools.
- Show faction/leader/unit references, relics, fragments, notes, captured units, map tokens, laws, and point sources.
- Finish the shared payment, token allocation, production, landing, trade, agenda, and hand-management controls.
- Show card timing and played/targeted card text in every reaction. Use the current expansion/errata content.
- Restore the combat simulator and show its results with clear assumptions.

### Then: remove multiplayer waiting time

- Complete the tactical draft flow and reversible player undo.
- Add parallel preparation for all strategy primaries and secondaries; start with token allocation, readying, Trade, research, and home production.
- Add private status/scoring and agenda preparation without changing resolution order.
- Add per-player summaries, sound/mute, named reaction auto-pass, and reviewed forced-choice automation.
- Support the bluffing reaction-window behavior in the engine and show it consistently in the UI.

These groups cover the bugs/rules, decision flow, map/player state, combat/production, card/trade/agenda/scoring, and verification sections of [TODO.md](../../TODO.md). Keep rule fixes and missing engine support visible beside the UI work that depends on them.

## 13. Check the experience, not just whether a view opens

Use these checks when accepting a UI change:

- A player can name the live actor, current decider, blocking task, and their own next step without clicking.
- A decision shows its key facts without clicks. Its full rule/card/state reference takes at most one click from that decision.
- Waiting players can prepare supported choices without changing live state or exposing private intentions.
- A prepared, still-valid secondary needs one confirmation when its real choice arrives. Changed entries explain what needs review.
- One task confirmation handles repeated engine steps without repeated user prompts, unless a new meaningful choice or reaction intervenes.
- The player can see what committed and what remains after an interrupted move, payment, build, landing, or research flow.
- The board keeps camera, map view, and useful selection through decisions, references, Live/Draft switches, and normal updates.
- Results name what happened and its cause. No common gameplay event ends as an unexplained “Decision resolved”.
- Required controls, Resume, reference access, and error recovery remain reachable at 1440×900, 1024×768, 390×844, and a short landscape size. (Superseded for `web2/` on 2026-10-07: only 1920×1080 or larger is a target; see `web2/AGENTS.md`.) Check keyboard use as well as mouse/touch.
- The acting player, reacting player, uninvolved player, and spectator each see the right public/private information and attention level.

### Coverage needed before calling the decision UI complete

1. Exercise every frontend workflow and every fallback family with realistic data. Include missing context, empty options, missing finish, rejection, reconnect, and changed draft cases.
2. Run every strategy card's primary and secondary through to completion. Include eligible, ineligible, declined, free, modified, and multi-player prepared cases; check the two Thunder's Edge variants too.
3. Run the complete agenda phase: reveal, reactions/riders, voting, spending, tiebreak, effect, and active-law display.
4. Run uncontested and contested invasions, space combat, interrupted landings, and final result displays from all viewer roles.
5. Run production with payment/placement interruptions, overpayment/credit, stock limits, fleet supply, and capacity changes.
6. Run public and secret scoring, spending objectives, a win during resolution, and the final point breakdown.

Use the gallery for style and isolated controls. Use real engine scenarios for order, payment, privacy, and completion. Track time spent waiting for an answer, clicks used to find facts, repeated prompts, and lost/invalid drafts. Compare the same journeys before and after changes.

## Related plans

- [Decision UI consistency](2026-09-24-DECISION_UI_CONSISTENCY_PLAN.md)
- [Tactical draft UX](2026-10-04-TACTICAL_DRAFT_UX_PLAN.md)
- [Browser planning workspace](2026-10-03-PLANNING_BROWSER_WORKSPACE_PLAN.md)
- [Hierarchical event log](2026-09-27-HIERARCHICAL_EVENT_LOG_PLAN.md)
- [Space combat overlay states](2026-09-27-SPACE_COMBAT_OVERLAY_STATES_PLAN.md)
- [Invasion overlay](2026-09-27-INVASION_OVERLAY_PLAN.md)

Use these guidelines as the shared design rules when those plans add or change a workflow.
