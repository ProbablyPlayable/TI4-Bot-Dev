import { describe, expect, it } from "vitest";
import { examples } from "./data";
import { EXAMPLE_IDS } from "./exampleList";
import { selectShell } from "./select/shell";
import { shortcuts } from "../model";
import { E } from "./loose";
import { createWorld, currentState, loadExample, reduce, setViewer } from "./world";

/** The blocks of an action; for a strategy card, the editor in the open row of the viewer. */
function editorBlocks(action: ReturnType<typeof selectShell>["action"]) {
  if (action.kind !== "flow") {
    throw new Error("not a flow");
  }
  const list = action.blocks[0];
  if (list?.kind !== "seats") {
    return action.blocks;
  }
  return list.rows.find((row) => row.open)?.open ?? [];
}

/**
 * Plays the open space battle with the first choice that is allowed at every stop. `stop` sees the
 * stage before each move; true ends the play there. Returns that stage, or null when the battle
 * ended or did not end in 60 moves.
 */
function playBattle(
  world: ReturnType<typeof createWorld>,
  stop: (stage: string) => boolean = () => false,
): string | null {
  const state = currentState(world);
  for (let turn = 0; turn < 60 && state.frontier === 2; turn++) {
    const stage: string = state.battle.stage;
    if (stop(stage)) {
      return stage;
    }
    if (stage === "pre") {
      reduce(world, { type: "reaction", action: "pass" });
      reduce(world, { type: "battle", action: "roll" });
    } else if (stage === "reaction") {
      reduce(world, { type: "reaction", action: "pass" });
    } else if (stage === "retreat") {
      const [system] = Object.keys(selectShell(world).board.task!.values);
      reduce(world, { type: "toggleSystem", system });
      reduce(world, { type: "battle", action: "retreat" });
    } else if (stage === "assign") {
      const view = selectShell(world).action;
      if (view.kind !== "tactical" || view.task.content.kind !== "combat") {
        throw new Error("not in combat");
      }
      const offer = view.task.content.records
        .at(-1)!
        .table.sides.flatMap((side) => side.rows)
        .find((row) => row.assign.some((pick) => !pick.disabled));
      if (offer) {
        reduce(world, { type: "stageHit", unit: offer.unit, kind: offer.assign[0].kind });
      } else {
        reduce(world, { type: "battle", action: "assignHits" });
      }
    } else {
      reduce(world, { type: "simulate" });
    }
    selectShell(world);
  }
  return null;
}

describe("mock engine", () => {
  it("the demo bar lists only examples that exist", () => {
    expect(EXAMPLE_IDS.filter((id) => !examples[id])).toEqual([]);
  });

  it.each(Object.keys(examples))("builds and selects %s", (example) => {
    const world = createWorld();
    loadExample(world, example);
    const view = selectShell(world);
    expect(view.board.tiles).toHaveLength(61);
    expect(view.action.title).toBeTruthy();
  });

  it.each(["hacan", "observer"])("selects every live example as %s", (viewer) => {
    const world = createWorld();
    for (const example of Object.keys(examples).filter((key) => examples[key].mode === "live")) {
      loadExample(world, example);
      setViewer(world, viewer);
      expect(selectShell(world).action.contentKey).toBeTruthy();
    }
  });

  it("applies a draft and plays space combat to the end", () => {
    const world = createWorld();
    loadExample(world, "draft-combat");
    expect(selectShell(world).apply?.items.length).toBeGreaterThan(1);
    reduce(world, { type: "confirmApply" });
    expect(world.mode).toBe("live");
    const state = currentState(world);
    expect(state.frontier).toBe(2);
    playBattle(world);
    expect(state.battle.stage).toBe("done");
  });

  it("edits movement in a draft and undoes it", () => {
    const world = createWorld();
    loadExample(world, "draft-movement");
    reduce(world, { type: "setCount", key: "j-carrier", value: 0 });
    expect(currentState(world).edit.dirty).toBe(true);
    reduce(world, { type: "setCount", key: "j-carrier", value: 1 });
    reduce(world, { type: "commitEdit" });
    expect(currentState(world).done[1]).toBe(true);
    reduce(world, { type: "undo" });
    expect(selectShell(world).toolbar.draft?.canRedo).toBe(true);
  });

  it("runs the other actions", () => {
    const world = createWorld();
    loadExample(world, "live-picker");
    reduce(world, { type: "pickAction", action: "component" });
    reduce(world, { type: "togglePlanet", planet: "jord" });
    reduce(world, { type: "flow", action: "play" });
    expect(selectShell(world).toolbar.status).toBe("Component action complete");
    loadExample(world, "live-secondary");
    reduce(world, { type: "flowCount", key: "buy", value: 0 });
    reduce(world, { type: "flowCount", key: "pools.t", value: 0 });
    reduce(world, { type: "flow", action: "ready" });
    for (let seat = 0; seat < 9; seat++) {
      reduce(world, { type: "simulate" });
    }
    expect(selectShell(world).toolbar.status).toBe("Strategic action complete");
    reduce(world, { type: "inspectLogEntry", id: "h3" });
    expect(selectShell(world).toolbar.workspace).toBe("history");
  });

  it("opens a picked tactical action as a draft and goes back without a change", () => {
    const world = createWorld();
    loadExample(world, "live-picker");
    reduce(world, { type: "pickAction", action: "tactical" });
    expect(world.mode).toBe("draft");
    expect(world.workspaces.live.kind).toBe("picker");
    const footer = selectShell(world).action;
    if (footer.kind !== "tactical") {
      throw new Error("not tactical");
    }
    expect(footer.task.footer.actions.map((action) => action.key)).toContain("Escape");
    reduce(world, { type: "backToPicker" });
    expect(world.mode).toBe("live");
    expect(selectShell(world).action.title).toBe("Your turn");
  });

  it("continues a prepared draft from the picker", () => {
    const world = createWorld();
    loadExample(world, "live-picker");
    world.workspaces.draft = createWorld().workspaces.draft;
    reduce(world, { type: "pickAction", action: "tactical" });
    expect(currentState(world).done[0]).toBe(true);
  });

  it("drops a staged strategic action, then plays a component action and ends the turn", () => {
    const world = createWorld();
    loadExample(world, "live-picker");
    reduce(world, { type: "pickAction", action: "strategic" });
    expect(selectShell(world).accent).toBe("draft");
    reduce(world, { type: "backToPicker" });
    expect(currentState(world).kind).toBe("picker");
    reduce(world, { type: "endTurn" });
    expect(currentState(world).kind).toBe("picker");
    reduce(world, { type: "pickAction", action: "component" });
    reduce(world, { type: "togglePlanet", planet: "jord" });
    reduce(world, { type: "flow", action: "play" });
    const done = selectShell(world).action;
    expect(done.closing).toHaveLength(1);
    expect(shortcuts(done).get("enter")).toEqual({ type: "endTurn" });
    reduce(world, { type: "endTurn" });
    expect(currentState(world).kind).toBe("waiting");
    reduce(world, { type: "simulate" });
    expect(currentState(world).kind).toBe("picker");
  });

  it("offers Pass only after the strategy card is used", () => {
    const world = createWorld();
    loadExample(world, "live-picker");
    expect(shortcuts(selectShell(world).action).has("p")).toBe(false);
    reduce(world, { type: "pass" });
    expect(currentState(world).kind).toBe("picker");
    world.usedCards.push(1);
    expect(shortcuts(selectShell(world).action).get("p")).toEqual({ type: "pass" });
    reduce(world, { type: "pass" });
    expect(currentState(world).flow.passed).toBe(true);
  });

  it("shows no closing state in history or to another seat", () => {
    const world = createWorld();
    loadExample(world, "summary");
    expect(selectShell(world).action.closing).toHaveLength(1);
    setViewer(world, "hacan");
    expect(selectShell(world).action.closing).toHaveLength(0);
  });

  it("shows two strategy cards and several action cards for four players", () => {
    const world = createWorld();
    loadExample(world, "live-picker-4p");
    const view = selectShell(world);
    expect(view.players.rows).toHaveLength(4);
    expect(view.players.rows[0].strategyCards.map((card) => card.number)).toEqual([1, 5]);
    expect(
      view.board.tiles.flatMap((tile) => tile.fleets).map((fleet) => fleet.seat),
    ).not.toContain("naalu");
    const keys = shortcuts(view.action);
    expect(keys.has("1")).toBe(true);
    expect(keys.has("5")).toBe(false);
    expect(keys.has("p")).toBe(false);
    expect(keys.get("a")).toEqual({ type: "pickGroup", group: "actionCards" });
    reduce(world, keys.get("a")!);
    const cards = shortcuts(selectShell(world).action);
    expect(cards.get("4")).toEqual({ type: "pickAction", action: "component", card: "Ghost Ship" });
    reduce(world, cards.get("4")!);
    // Esc goes one level back: to the list of action cards, then to the actions.
    reduce(world, { type: "backToPicker" });
    expect(shortcuts(selectShell(world).action).has("4")).toBe(true);
    reduce(world, { type: "backToPicker" });
    expect(shortcuts(selectShell(world).action).has("t")).toBe(true);
    reduce(world, { type: "pickAction", action: "component", card: "Ghost Ship" });
    reduce(world, { type: "flow", action: "play" });
    reduce(world, { type: "endTurn" });
    reduce(world, { type: "simulate" });
    // The picker has the same rows; the list of action cards is shorter.
    expect(shortcuts(selectShell(world).action).has("a")).toBe(true);
    reduce(world, { type: "pickGroup", group: "actionCards" });
    expect(shortcuts(selectShell(world).action).has("4")).toBe(false);
  });

  // Decisions: one frame, three shapes. A choice is staged; the main button sends it.
  const footerOf = (world: ReturnType<typeof createWorld>) => {
    const action = selectShell(world).action;
    if (action.kind !== "flow") {
      throw new Error("not a flow");
    }
    return action.footer.actions;
  };
  const main = (world: ReturnType<typeof createWorld>) =>
    footerOf(world).find((action) => action.tone === "primary")!;
  const openCard = (card: string) => {
    const world = createWorld();
    loadExample(world, "live-picker-4p");
    reduce(world, { type: "pickAction", action: "component", card });
    return world;
  };

  it("chooses a system on the board for Unexpected Action", () => {
    const world = openCard("Unexpected Action");
    const task = selectShell(world).board.task!;
    expect(task.target).toBe("system");
    expect(Object.keys(task.values).sort()).toEqual(["33", "38"]);
    expect(main(world).disabled).toBe(true);
    reduce(world, { type: "toggleSystem", system: "27" });
    expect(currentState(world).flow.chosen).toBe(null);
    reduce(world, { type: "toggleSystem", system: "38" });
    expect(selectShell(world).board.task!.chosen).toEqual({ "38": true });
    expect(selectShell(world).accent).toBe("draft");
    // Esc clears the choice first, then goes back to the list of action cards.
    expect(shortcuts(selectShell(world).action).get("escape")).toEqual({ type: "clearChoice" });
    reduce(world, { type: "clearChoice" });
    expect(shortcuts(selectShell(world).action).get("escape")).toEqual({ type: "backToPicker" });
    reduce(world, { type: "toggleSystem", system: "38" });
    reduce(world, main(world).intent);
    expect(currentState(world).flow.stage).toBe("done");
    expect(selectShell(world).board.task).toBe(null);
    expect(world.table.actionCards).not.toContain("Unexpected Action");
    expect(shortcuts(selectShell(world).action).get("enter")).toEqual({ type: "endTurn" });
  });

  it("chooses a player in the player table for Spy", () => {
    const world = openCard("Spy");
    const pick = selectShell(world).players.pick!;
    expect(pick.seats).toEqual({
      sol: { reason: "You" },
      hacan: { reason: null },
      xxcha: { reason: null },
      letnev: { reason: "No action cards" },
    });
    reduce(world, { type: "pickSeat", seat: "letnev" });
    expect(currentState(world).flow.chosen).toBe(null);
    reduce(world, { type: "pickSeat", seat: "xxcha" });
    expect(selectShell(world).players.pick!.chosen).toEqual(["xxcha"]);
    reduce(world, main(world).intent);
    expect(selectShell(world).players.pick).toBe(null);
    expect(currentState(world).flow.result).toContain("Blair");
  });

  it("chooses one answer of an offer by key", () => {
    const world = createWorld();
    loadExample(world, "live-decision-offer");
    const view = selectShell(world).action;
    if (view.kind !== "flow") {
      throw new Error("not a flow");
    }
    expect(view.blocks[0]).toMatchObject({ kind: "source", name: "Merchant Station" });
    expect(main(world).disabled).toBe(true);
    reduce(world, shortcuts(view).get("2")!);
    expect(currentState(world).flow.chosen).toBe("convert");
    reduce(world, main(world).intent);
    expect(currentState(world).flow.result).toContain("Trade goods 2 → 3");
    // A decision that is not the viewer's action does not end in the closing state.
    expect(selectShell(world).action.closing).toHaveLength(0);
  });

  it("removes ships until the fleet supply holds", () => {
    const world = createWorld();
    loadExample(world, "live-decision-units");
    expect(main(world).disabled).toBe(true);
    reduce(world, { type: "flowCount", key: "j-cruiser", value: 1 });
    expect(main(world)).toMatchObject({ disabled: false, label: "Remove 1 ship" });
    reduce(world, main(world).intent);
    expect(currentState(world).flow.result).toContain("Fleet supply 2 / 2");
  });

  // Reaction windows: the same block and the same footer inside and outside a battle.
  it("answers a reaction to another player's card: Pass is the main button", () => {
    const world = createWorld();
    loadExample(world, "live-reaction");
    const view = selectShell(world).action;
    expect(view.interrupt?.eyebrow).toBe("Reaction · After Blair plays Mining Initiative");
    expect(shortcuts(view).get("enter")).toEqual({ type: "reaction", action: "pass" });
    reduce(world, shortcuts(view).get("1")!);
    const staged = selectShell(world);
    expect(staged.accent).toBe("draft");
    expect(main(world)).toMatchObject({ label: "Play Sabotage" });
    expect(shortcuts(staged.action).get("escape")).toEqual({ type: "clearChoice" });
    reduce(world, { type: "clearChoice" });
    expect(main(world)).toMatchObject({ label: "Pass" });
    reduce(world, { type: "stageReaction", card: "Sabotage" });
    reduce(world, main(world).intent);
    expect(currentState(world).flow.result).toContain("was cancelled");
    expect(currentState(world).hands.sol).not.toContain("Sabotage");
    expect(selectShell(world).action.interrupt).toBe(null);
  });

  const toDirectHit = (world: ReturnType<typeof createWorld>) => {
    loadExample(world, "draft-combat");
    reduce(world, { type: "confirmApply" });
    return playBattle(world, (stage) => stage === "reaction") === "reaction";
  };

  it("offers Morale Boost in the same reaction window at the start of a round", () => {
    const world = createWorld();
    loadExample(world, "live-combat");
    const footer = () => {
      const view = selectShell(world).action;
      if (view.kind !== "tactical") {
        throw new Error("not tactical");
      }
      return { labels: view.task.footer.actions.map((action) => action.label), view };
    };
    expect(footer().view.interrupt?.eyebrow).toBe("Reaction · Start of combat round 1");
    expect(footer().labels).toEqual(["Pass"]);
    // The roll waits for the answer.
    const rolls = currentState(world).battle.records.length;
    reduce(world, { type: "battle", action: "roll" });
    expect(currentState(world).battle.records).toHaveLength(rolls);
    reduce(world, { type: "stageReaction", card: "Morale Boost" });
    expect(footer().labels).toEqual(["Clear choice", "Play Morale Boost"]);
    reduce(world, { type: "reaction", action: "play" });
    expect(currentState(world).hands.sol).not.toContain("Morale Boost");
    expect(currentState(world).battle.boost.att).toBe(true);
    expect(footer().view.interrupt).toBe(null);
    expect(footer().labels).toContain("Roll combat dice");
  });

  it("chooses the retreat destination on the board", () => {
    const world = createWorld();
    loadExample(world, "live-combat");
    reduce(world, { type: "reaction", action: "pass" });
    reduce(world, { type: "battle", action: "announceRetreat" });
    const state = currentState(world);
    expect(playBattle(world, (stage) => stage === "retreat")).toBe("retreat");
    const task = selectShell(world).board.task!;
    expect(task).toMatchObject({ target: "system", kind: "pick", interactive: true });
    expect(Object.keys(task.values).sort()).toEqual(["1", "23"]);
    reduce(world, { type: "battle", action: "retreat" });
    expect(state.battle.stage).toBe("retreat");
    reduce(world, { type: "toggleSystem", system: "27" });
    expect(state.battle.pick).toBe(null);
    reduce(world, { type: "toggleSystem", system: "23" });
    expect(selectShell(world).board.task!.chosen).toEqual({ "23": true });
    reduce(world, { type: "clearChoice" });
    expect(state.battle.pick).toBe(null);
    reduce(world, { type: "toggleSystem", system: "1" });
    reduce(world, { type: "battle", action: "retreat" });
    expect(state.battle.retreat.to).toBe("Jord · #1");
    expect(selectShell(world).board.task).toBe(null);
  });

  it("shows Direct Hit as the same reaction window in a battle", () => {
    const world = createWorld();
    expect(toDirectHit(world)).toBe(true);
    const view = selectShell(world).action;
    if (view.kind !== "tactical") {
      throw new Error("not tactical");
    }
    expect(view.interrupt?.eyebrow).toMatch(/^Reaction · After Alex’s .* used Sustain Damage$/);
    expect(view.task.footer.actions.map((action) => action.label)).toEqual(["Pass"]);
    reduce(world, { type: "stageReaction", card: "Direct Hit" });
    const staged = selectShell(world).action;
    if (staged.kind !== "tactical") {
      throw new Error("not tactical");
    }
    expect(staged.task.footer.actions.map((action) => action.label)).toEqual([
      "Clear choice",
      "Play Direct Hit",
    ]);
    reduce(world, { type: "reaction", action: "play" });
    expect(currentState(world).hands.sol).not.toContain("Direct Hit");
  });

  it("skips the window of a card that is set to Never offer, and says so", () => {
    const world = createWorld();
    reduce(world, { type: "setCardOffer", card: "Direct Hit", never: true });
    expect(
      selectShell(world).reference.offerCards.find((item) => item.card === "Direct Hit"),
    ).toMatchObject({ never: true });
    world.toast = null;
    const toasts: string[] = [];
    loadExample(world, "draft-combat");
    reduce(world, { type: "confirmApply" });
    const collect = () => {
      const shown = world.toast as { text: string } | null;
      if (shown) {
        toasts.push(shown.text);
      }
    };
    playBattle(world, (stage) => {
      collect();
      expect(stage).not.toBe("reaction");
      return false;
    });
    collect();
    expect(toasts).toContain("Direct Hit was not offered: it is set to Never offer.");
  });

  it("stages a payment with the least waste, and resets it", () => {
    const world = createWorld();
    loadExample(world, "live-strategic");
    // An open payment is on the board and in the footer, not a block of the panel.
    const payment = () => {
      const view = selectShell(world).board.task?.payment;
      if (!view) {
        throw new Error("no payment");
      }
      return view;
    };
    expect(editorBlocks(selectShell(world).action).some((item) => item.kind === "payment")).toBe(
      false,
    );
    expect(payment().actions.map((action) => [action.label, action.disabled])).toEqual([
      ["Auto-pay", false],
      ["Clear payment", true],
    ]);
    reduce(world, { type: "payment", action: "auto" });
    expect(payment().paid).toBe(payment().cost);
    const shown = selectShell(world).action;
    expect(shown.kind === "flow" && shown.footer.payment).toMatchObject({
      paid: payment().paid,
      summary: payment().summary,
    });
    expect(payment().goods).toMatchObject({ value: 0, max: 2, rest: null });
    // Trade goods pay one each. "Pay rest" is the count that makes the payment exact.
    reduce(world, { type: "payment", action: "reset" });
    reduce(world, { type: "togglePlanet", planet: "vefut" });
    expect(payment().goods?.rest).toBe(1);
    reduce(world, { type: "setPayment", source: "goods", value: 1 });
    expect(payment().paid).toBe(3);
    expect(payment().goods).toMatchObject({ value: 1, rest: null });
    reduce(world, { type: "setPayment", source: "goods", value: 2 });
    expect(payment().paid).toBe(4);
    expect(payment().goods?.rest).toBe(1);
    reduce(world, { type: "payment", action: "reset" });
    expect(payment().paid).toBe(0);
    loadExample(world, "draft-production");
    reduce(world, { type: "payment", action: "auto" });
    const state = currentState(world);
    const total = E.productionTotals(state, state.edit.value);
    expect(total.paid).toBeGreaterThanOrEqual(total.cost);
  });

  describe("strategy cards", () => {
    const open = (example: string) => {
      const world = createWorld();
      loadExample(world, example);
      return world;
    };
    const flow = (world: ReturnType<typeof createWorld>) => currentState(world).flow;
    const footer = (world: ReturnType<typeof createWorld>) => {
      const action = selectShell(world).action;
      if (action.kind !== "flow") {
        throw new Error("not a flow");
      }
      return action.footer;
    };
    const main = (world: ReturnType<typeof createWorld>) =>
      footer(world).actions.find((action) => action.tone === "primary")!;

    it.each([2, 3, 4, 5, 6, 7, 8])("opens card %i from the picker by its number", (number) => {
      const world = open("live-picker");
      world.table.cards = { sol: [number] };
      const key = shortcuts(selectShell(world).action).get(`${number}`)!;
      reduce(world, key);
      expect(flow(world).number).toBe(number);
      expect(selectShell(world).accent).toBe("draft");
      // Nothing is sent: Esc goes back to the actions.
      reduce(world, shortcuts(selectShell(world).action).get("escape")!);
      expect(currentState(world).kind).toBe("picker");
    });

    it("Diplomacy: a system on the board, then up to 2 planets; Esc clears the last choice", () => {
      const world = open("live-strategy-2");
      expect(selectShell(world).board.task?.target).toBe("system");
      expect(main(world).disabled).toBe(true);
      reduce(world, { type: "toggleSystem", system: "50" });
      expect(flow(world).mine.system).toBeNull();
      reduce(world, { type: "toggleSystem", system: "27" });
      expect(selectShell(world).board.task?.target).toBe("planet");
      for (const planet of ["vefut", "quann", "lor", "jord"]) {
        reduce(world, { type: "togglePlanet", planet });
      }
      expect(flow(world).mine.planets).toEqual(["vefut", "quann"]);
      reduce(world, shortcuts(selectShell(world).action).get("escape")!);
      expect(flow(world).mine.planets).toEqual(["vefut"]);
      reduce(world, { type: "clearPart", part: "system" });
      expect(selectShell(world).board.task?.target).toBe("system");
      reduce(world, { type: "toggleSystem", system: "27" });
      reduce(world, shortcuts(selectShell(world).action).get("enter")!);
      expect(flow(world).stage).toBe("secondary");
      expect(flow(world).primaryResult).toContain("Starpoint");
      expect(flow(world).primaryResult).toContain("readied Vefut");
    });

    it("Politics: the speaker in the player table is sent first, then the agenda cards", () => {
      const world = open("live-strategy-3");
      const pick = selectShell(world).players.pick!;
      expect(pick.seats.hacan.reason).toBe("Is the speaker");
      reduce(world, { type: "pickSeat", seat: "hacan" });
      expect(flow(world).mine.seat).toBeNull();
      reduce(world, { type: "pickSeat", seat: "xxcha" });
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).stage).toBe("primary");
      expect(selectShell(world).players.pick).toBeNull();
      // The first part is sent, so the action cannot be dropped.
      expect(footer(world).actions.some((action) => action.intent.type === "backToPicker")).toBe(
        false,
      );
      expect(main(world).disabled).toBe(true);
      reduce(world, shortcuts(selectShell(world).action).get("1")!);
      reduce(world, shortcuts(selectShell(world).action).get("3")!);
      expect(flow(world).mine.agenda).toEqual(["top", "top"]);
      reduce(world, { type: "chooseOption", option: "swap", group: "agenda" });
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).primaryResult).toContain("made Blair the speaker");
    });

    it("Construction: the structure in a list, the planet on the board; the second is a PDS", () => {
      const world = open("live-strategy-4");
      expect(selectShell(world).board.task).toBeNull();
      reduce(world, shortcuts(selectShell(world).action).get("1")!);
      const task = selectShell(world).board.task!;
      // Jord and Arnor have a space dock.
      expect("jord" in task.values).toBe(false);
      expect("vefut" in task.values).toBe(true);
      reduce(world, { type: "togglePlanet", planet: "jord" });
      expect(flow(world).mine.build[0].planet).toBeNull();
      reduce(world, { type: "togglePlanet", planet: "vefut" });
      expect(main(world).label).toBe("Resolve primary · 1 structure");
      reduce(world, { type: "togglePlanet", planet: "jord" });
      expect(flow(world).mine.build[1]).toEqual({ type: "pds", planet: "jord" });
      expect(selectShell(world).board.task).toMatchObject({
        interactive: false,
        chosen: { vefut: true, jord: true },
      });
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).primaryResult).toBe(
        "Jamie placed a space dock on Vefut and a PDS on Jord.",
      );
    });

    it("Trade: several players in the player table, with what each gains", () => {
      const world = open("live-strategy-5");
      const pick = selectShell(world).players.pick!;
      expect(pick.seats.jolnar.reason).toBe("Commodities full");
      expect(pick.seats.hacan.note).toBe("+6 commodities");
      expect(pick.seats.sol.reason).toBe("You");
      for (const seat of ["hacan", "jolnar", "letnev"]) {
        reduce(world, { type: "pickSeat", seat });
      }
      expect(selectShell(world).players.pick!.chosen).toEqual(["hacan", "letnev"]);
      reduce(world, { type: "clearPart", part: "seat:hacan" });
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).primaryResult).toContain("chose Casey for a free replenish");
    });

    it("Warfare: a token on the board and the pools as counters", () => {
      const world = open("live-strategy-6");
      expect(Object.keys(selectShell(world).board.task!.values).sort()).toEqual(["33", "38"]);
      reduce(world, { type: "toggleSystem", system: "33" });
      expect(footer(world).note).toContain("Place 10 tokens");
      reduce(world, { type: "flowCount", key: "pools.t", value: 4 });
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).primaryResult).toContain("Pools 3 · 4 · 2 → 4 · 4 · 2");
    });

    it("Warfare secondary: production with a payment, drafted before the seat", () => {
      const world = open("live-secondary-6");
      expect(main(world).label).toBe("Mark draft ready · pass");
      reduce(world, { type: "flowCount", key: "counts.cruiser", value: 1 });
      expect(footer(world).note).toBe("Stage 2 more resources to produce.");
      reduce(world, { type: "payment", action: "auto" });
      expect(main(world).label).toBe("Mark draft ready");
      reduce(world, { type: "flow", action: "ready" });
      for (let turn = 0; turn < 4; turn++) {
        reduce(world, { type: "simulate" });
      }
      expect(flow(world).results.sol).toBe("Followed · produced 1 cruiser in Jord for 2 resources");
    });

    it("Esc clears staged counters: the payment, then the pools, then the bought tokens", () => {
      const world = open("live-strategy-6");
      reduce(world, { type: "flowCount", key: "pools.t", value: 4 });
      reduce(world, { type: "clearChoice" });
      expect(flow(world).mine.pools).toEqual({ t: 3, f: 4, s: 2 });
      loadExample(world, "live-secondary-6");
      reduce(world, { type: "flowCount", key: "counts.cruiser", value: 1 });
      reduce(world, { type: "payment", action: "auto" });
      reduce(world, { type: "clearChoice" });
      expect(flow(world).mine.pay).toEqual({});
      expect(flow(world).mine.counts.cruiser).toBe(1);
      reduce(world, { type: "clearChoice" });
      expect(flow(world).mine.counts).toEqual({});
      expect(main(world).label).toBe("Mark draft ready · pass");
    });

    it("another viewer sees the public side only, and cannot edit", () => {
      const world = open("live-secondary-6");
      setViewer(world, "hacan");
      const view = selectShell(world);
      if (view.action.kind !== "flow") {
        throw new Error("not a flow");
      }
      const seats = view.action.blocks.find((block) => block.kind === "seats");
      if (seats?.kind !== "seats") {
        throw new Error("no seat list");
      }
      expect(seats.rows.every((row) => !row.open)).toBe(true);
      expect(seats.rows.find((row) => row.seat === "hacan")).toMatchObject({ you: true });
      const jamie = seats.rows.find((row) => row.seat === "sol")!;
      expect(jamie.you).toBe(false);
      expect(jamie.status.label).not.toContain("draft");
      expect(view.board.task).toBe(null);
      reduce(world, { type: "flowCount", key: "counts.cruiser", value: 1 });
      expect(flow(world).mine.counts).toEqual({});
      // A staged action card of Jamie is not sent yet, so it is not visible.
      loadExample(world, "live-decision-offer");
      setViewer(world, "hacan");
      const decision = selectShell(world);
      expect(decision.players.pick).toBe(null);
      expect(decision.action.kind === "flow" && decision.action.blocks).toEqual([]);
      expect(decision.action.kind === "flow" && decision.action.footer.actions).toEqual([]);
    });

    it("Technology: the tree, a second technology for 6 resources that counts the first", () => {
      const world = open("live-strategy-7");
      const cell = (id: string) => {
        const tree = editorBlocks(selectShell(world).action).find(
          (block) => block.kind === "techs",
        );
        if (tree?.kind !== "techs") {
          throw new Error("no tree");
        }
        return [
          ...tree.columns.flatMap((column) => column.cells),
          ...tree.bands.flatMap((band) => band.cells),
        ].find((item) => item.id === id)!;
      };
      expect(cell("antimass-deflectors").state).toBe("owned");
      // Blue 2 and the specialty of Arnor.
      expect(cell("light-wave-deflector").state).toBe("open");
      expect(cell("graviton-laser-system").state).toBe("closed");
      expect(cell("graviton-laser-system").needs).toEqual([{ color: "Y", missing: true }]);
      reduce(world, { type: "pickTech", tech: "graviton-laser-system" });
      expect(flow(world).mine.techs).toEqual([]);
      reduce(world, { type: "pickTech", tech: "sarween-tools" });
      expect(cell("graviton-laser-system").state).toBe("open");
      reduce(world, { type: "pickTech", tech: "graviton-laser-system" });
      expect(footer(world).note).toBe("Stage 6 more resources to research.");
      reduce(world, { type: "payment", action: "auto" });
      expect(main(world).disabled).toBe(false);
      // Without the first technology the second one has no prerequisite.
      reduce(world, { type: "pickTech", tech: "sarween-tools" });
      expect(flow(world).mine.techs).toEqual([]);
      expect(flow(world).mine.pay).toEqual({});
      reduce(world, { type: "pickTech", tech: "sarween-tools" });
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).primaryResult).toBe("Jamie researched Sarween Tools.");
    });

    it("Imperial: a fulfilled objective in a list, and the outcome that always happens", () => {
      const world = open("live-strategy-8");
      expect(main(world).label).toBe("Resolve primary · score nothing");
      expect(shortcuts(selectShell(world).action).has("1")).toBe(false);
      reduce(world, { type: "chooseOption", option: "Corner the Market", group: "objective" });
      expect(flow(world).mine.objective).toBeNull();
      reduce(world, shortcuts(selectShell(world).action).get("3")!);
      reduce(world, { type: "flow", action: "resolve" });
      expect(flow(world).primaryResult).toContain("scored Expand Borders (victory points 6 → 7)");
    });

    it("one list has every seat; only the row of the viewer is open", () => {
      const world = open("live-secondary");
      const rows = () => {
        const action = selectShell(world).action;
        if (action.kind !== "flow") {
          throw new Error("not a flow");
        }
        const block = action.blocks[0];
        if (block.kind !== "seats") {
          throw new Error("no seat list");
        }
        return block.rows;
      };
      expect(rows().map((row) => `${row.order} ${row.name} · ${row.status.label}`)).toEqual([
        "P Alex · Deciding",
        "1 Blair · Waits for Alex",
        "2 Casey · Waits for Blair",
        "3 Bartholomew · Waits for Casey",
        "4 Erin · Waits for Bartholomew",
        "5 Maximilian Alexander · Waits for Erin",
        "6 Gale · Waits for Maximilian Alexander",
        "7 You · Private draft",
      ]);
      expect(
        rows()
          .filter((row) => row.open)
          .map((row) => row.name),
      ).toEqual(["You"]);
      expect(selectShell(world).board.task?.kind).toBe("pay");
      // A resolved seat has what it did on its line. Nothing of a seat that waits.
      reduce(world, { type: "simulate" });
      reduce(world, { type: "simulate" });
      expect(rows()[0]).toMatchObject({ status: { sign: "✓", label: "Resolved" } });
      expect(rows()[0].text).toContain("Alex gained 3 command tokens");
      expect(rows()[1].status.label).toBe("Passed");
      expect(rows()[2].status.label).toBe("Deciding");
      expect(rows()[2].text).toBeUndefined();
      // A ready draft closes the row and says what it will do.
      reduce(world, { type: "payment", action: "auto" });
      reduce(world, { type: "flow", action: "ready" });
      expect(rows().some((row) => row.open)).toBe(false);
      expect(rows()[7].status.label).toBe("Draft ready");
      expect(rows()[7].text).toContain("Follow: bought 1 token for 3 influence");
      expect(selectShell(world).board.task).toBeNull();
    });

    it("the row of the viewer closes with its result; history has no open row", () => {
      const world = open("live-strategy-5");
      reduce(world, { type: "flow", action: "resolve" });
      const seats = () => {
        const action = selectShell(world).action;
        const block = action.kind === "flow" ? action.blocks[0] : undefined;
        if (block?.kind !== "seats") {
          throw new Error("no seat list");
        }
        return block.rows;
      };
      expect(seats()[0].open).toBeUndefined();
      expect(seats()[0].text).toContain("Jamie gained 3 trade goods");
      reduce(world, { type: "inspectLogEntry", id: "h2" });
      expect(selectShell(world).toolbar.workspace).toBe("history");
      expect(seats().some((row) => row.open)).toBe(false);
      expect(seats().map((row) => row.status.label)).not.toContain("Deciding");
    });

    it("a secondary without a choice is Follow or Pass; a free one says who gave it", () => {
      const world = open("live-secondary-5");
      expect(main(world).disabled).toBe(true);
      const action = selectShell(world).action;
      const menu = editorBlocks(action)[0];
      expect(menu && menu.kind === "menu" && menu.rows[0].state).toContain("Free · chosen by Alex");
      reduce(world, shortcuts(action).get("2")!);
      expect(main(world).label).toBe("Mark draft ready · pass");
      reduce(world, shortcuts(selectShell(world).action).get("1")!);
      reduce(world, { type: "flow", action: "ready" });
      for (let turn = 0; turn < 3; turn++) {
        reduce(world, { type: "simulate" });
      }
      expect(flow(world).results.sol).toBe("Followed · replenished commodities");
    });
  });
});
