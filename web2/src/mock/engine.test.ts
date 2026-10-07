import { describe, expect, it } from "vitest";
import { examples } from "./data";
import { selectShell } from "./select/shell";
import { createWorld, currentState, loadExample, reduce, setViewer } from "./world";

describe("mock engine", () => {
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
    for (let turn = 0; turn < 60 && state.frontier === 2; turn++) {
      const battle = state.battle;
      if (battle.stage === "pre") reduce(world, { type: "battle", action: "roll" });
      else if (battle.stage === "reaction")
        reduce(world, { type: "battle", action: "passReaction" });
      else if (battle.stage === "retreat") reduce(world, { type: "battle", action: "retreat" });
      else if (battle.stage === "assign") {
        const row = selectShell(world).action;
        if (row.kind !== "tactical" || row.task.content.kind !== "combat")
          throw new Error("not in combat");
        const offer = row.task.content.records
          .at(-1)!
          .table.sides.flatMap((side) => side.rows)
          .find((item) => item.assign.some((pick) => !pick.disabled));
        if (offer)
          reduce(world, { type: "stageHit", unit: offer.unit, kind: offer.assign[0].kind });
        else reduce(world, { type: "battle", action: "assignHits" });
      } else reduce(world, { type: "simulate" });
      selectShell(world);
    }
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
    reduce(world, { type: "flowTarget", planet: "jord" });
    reduce(world, { type: "flow", action: "play" });
    expect(selectShell(world).toolbar.status).toBe("Component action complete");
    loadExample(world, "live-secondary");
    reduce(world, { type: "flowCount", key: "buy", value: 0 });
    reduce(world, { type: "flow", action: "ready" });
    for (let seat = 0; seat < 9; seat++) reduce(world, { type: "simulate" });
    expect(selectShell(world).toolbar.status).toBe("Strategic action complete");
    reduce(world, { type: "inspectLogEntry", id: "h3" });
    expect(selectShell(world).toolbar.workspace).toBe("history");
  });
});
