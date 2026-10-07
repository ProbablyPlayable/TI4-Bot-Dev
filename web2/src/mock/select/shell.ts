// The whole screen: toolbar, player table, board, action panel, reference drawers.
import type {
  ListSectionView,
  LogEntryView,
  PlayerTableView,
  ReferenceView,
  Rich,
  ShellView,
  ToolbarView,
} from "../../model";
import { CARDS, HISTORY, SEATS, SEAT_IDS } from "../data";
import { E } from "../loose";
import { currentState, pastState, type State, type World } from "../world";
import { selectBoard } from "./board";
import { selectFlow } from "./flows";
import { isTactical, seatViews, stagesOf, statusText, summaryOf } from "./shared";
import { applyItems, selectTactical } from "./tactical";

const actor = (state: State): string => state.flow?.owner || "sol";

function cardOwners(state: State) {
  const owners = (
    [
      ["sol"],
      ["xxcha", true],
      ["letnev"],
      ["jolnar", true],
      ["hacan"],
      ["mentak", true],
      ["yssaril", true],
      ["naalu"],
    ] as [string, boolean?, number?][]
  ).map(([owner, used, tg]) => ({ owner, used: !!used, tg: tg ?? 0 }));
  if (state.flow?.card === "Leadership") {
    if (state.flow.owner === "hacan") [owners[0].owner, owners[4].owner] = ["hacan", "sol"];
    owners[0].used = true;
  }
  return owners;
}

function toolbar(world: World, state: State): ToolbarView {
  const draft = state.mode === "draft" && world.mode === "draft";
  return {
    round: 3,
    phase: "Action phase",
    status: statusText(world, state),
    workspace: world.mode,
    draftLocked: world.viewer !== "sol" ? "A draft is private to the acting player" : null,
    past: world.workspaces.history ? { label: world.workspaces.history.past.label } : null,
    draft: draft
      ? {
          canUndo: state.cursor > 0,
          canRedo: state.cursor < state.history.length - 1,
          canApply: E.canApply(state) && world.viewer === "sol" && !state.edit,
          applyHint: E.applyReadiness(state),
        }
      : null,
  };
}

/** One row for each player, in seat order. Rows do not move. */
function players(world: World, state: State): PlayerTableView {
  const owners = cardOwners(state);
  const now = world.mode === "history" ? null : actor(state);
  const card = (seat: string) => owners.findIndex((item) => item.owner === seat);
  const queue = SEAT_IDS.filter((seat) => !SEATS[seat].passed && card(seat) >= 0).sort(
    (a, b) => card(a) - card(b),
  );
  const next = now && queue.length > 1 ? queue[(queue.indexOf(now) + 1) % queue.length] : null;
  const me = world.viewer === "observer" ? "sol" : world.viewer;
  return {
    rows: SEAT_IDS.map((seat) => {
      const player = SEATS[seat];
      const index = card(seat);
      const tokens =
        seat === "sol" && isTactical(state) && state.mode === "live" && state.done[0]
          ? [player.tokens[0] - 1, ...player.tokens.slice(1)]
          : player.tokens;
      return {
        seat,
        isMe: seat === me,
        turn: now === seat ? "now" : next === seat ? "next" : null,
        speaker: !!player.speaker,
        passed: !!player.passed,
        victoryPoints: player.vp,
        strategyCards:
          index < 0 ? [] : [{ number: index + 1, name: CARDS[index], used: owners[index].used }],
        resources: player.res,
        influence: player.inf,
        tradeGoods: player.tg,
        commodities: player.comm,
        tokens,
        actionCards: player.ac,
        secrets: player.so,
        planets: player.planets,
        abilities: player.abilities,
        technologies: player.tech,
        leaders: player.leaders,
      };
    }),
    freeCards: owners.flatMap((item, index) =>
      item.owner ? [] : [{ number: index + 1, name: CARDS[index], tradeGoods: item.tg }],
    ),
  };
}

function reference(world: World, state: State): ReferenceView {
  const sym = (seat: string) => ({ seat });
  const section = (title: string, rows: (Rich | string)[]): ListSectionView => ({
    title,
    rows: rows.map((row) => (typeof row === "string" ? [row] : row)),
  });
  const cardText: Record<string, string> = {
    "Direct Hit": "after a ship sustains damage, destroy it",
    "Morale Boost": "+1 to combat rolls this round",
    Sabotage: "cancel an action card",
    "Ghost Ship": "place 1 destroyer in a wormhole system",
  };
  const live = world.workspaces.live;
  const entry = (item: (typeof HISTORY)[number]): LogEntryView => {
    const past = pastState(item);
    return {
      id: item.id,
      seat: item.seat,
      type: `${item.type}${isTactical(past) ? "" : " · " + past.flow.card}`,
      summary: summaryOf(past),
      stages: stagesOf(past).map(([name, text]) => ({ name, text })),
      current: false,
    };
  };
  const current: LogEntryView[] =
    live.kind !== "picker"
      ? [
          {
            id: "current",
            seat: actor(live),
            type: `${isTactical(live) ? "Tactical" : live.kind === "strategic" ? "Strategic" : "Component"} · in progress`,
            summary: summaryOf(live) || "Not started",
            stages: [],
            current: true,
          },
        ]
      : [];
  return {
    objectives: [
      section("Public objectives · stage I", [
        [
          "Corner the Market · 4 planets with the same trait · scored by ",
          sym("hacan"),
          " ",
          sym("xxcha"),
        ],
        ["Develop Weaponry · 2 unit upgrades · scored by ", sym("sol")],
        ["Sway the Council · spend 8 influence · scored by ", sym("hacan"), " ", sym("xxcha")],
        "Erect a Monument · spend 8 resources · not scored",
      ]),
      section("Your secret objectives", [
        "Destroy Their Greatest Ship · scored",
        "Occupy the Seat of the Empire · not scored",
      ]),
      section(
        "Points",
        SEAT_IDS.map((id) => [
          sym(id),
          ` ${SEATS[id].name} · ${SEATS[id].vp} of 10 · ${SEATS[id].so[0]} from secrets`,
        ]),
      ),
    ],
    technology: SEAT_IDS.map((id) =>
      section(`${SEATS[id].name} · ${SEATS[id].faction}`, SEATS[id].tech),
    ),
    cards: [
      section(
        "Your action cards",
        state.hands.sol.map((card: string) => `${card} · ${cardText[card] || ""}`),
      ),
      section(
        "Strategy cards",
        cardOwners(state).map((card, index): Rich =>
          card.owner
            ? [
                `${index + 1} ${CARDS[index]} · `,
                sym(card.owner),
                ` ${SEATS[card.owner].name}${card.used ? " · used" : ""}`,
              ]
            : [`${index + 1} ${CARDS[index]} · unclaimed · ${card.tg} TG`],
        ),
      ),
      section("Promissory notes", [
        "Trade Agreement (Hacan) · held by you",
        "Ceasefire (Sol) · held by Blair",
      ]),
    ],
    log: [3, 2].map((round) => ({
      round,
      label: `Round ${round}${round === 3 ? " · Action phase" : " · complete"}`,
      entries: [
        ...(round === 3 ? current : []),
        ...HISTORY.filter((item) => item.round === round).map(entry),
      ],
    })),
  };
}

export function selectShell(world: World): ShellView {
  E.env.viewer = world.viewer;
  const state = currentState(world);
  const tactical = isTactical(state);
  const canApply =
    world.mode === "draft" &&
    tactical &&
    state.mode === "draft" &&
    E.canApply(state) &&
    !state.edit;
  return {
    seats: seatViews,
    accent: state.mode === "draft" ? "draft" : state.frontier === null ? "done" : "live",
    toolbar: toolbar(world, state),
    players: players(world, state),
    board: selectBoard(world, state),
    action: tactical ? selectTactical(world, state) : selectFlow(world, state),
    reference: reference(world, state),
    apply: canApply
      ? {
          items: applyItems(state),
          cost: "Costs 1 tactic token.",
          note:
            state.frontier === null
              ? "The whole action is prepared."
              : "Dice and later decisions continue in Live.",
        }
      : null,
    reveal: state.reveal ?? null,
    toast: world.toast,
    announcement: world.announcement,
  };
}
