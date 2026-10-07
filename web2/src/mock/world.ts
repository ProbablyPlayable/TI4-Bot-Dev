// The dummy's world: three workspaces, the seat that looks at the screen, and the reducer that
// turns intents into engine calls. This is the body of the click handlers of the HTML dummy.
import type { Intent } from "../model";
import {
  HISTORY,
  KEYS,
  MAP,
  ORIGIN_IDS,
  PAY,
  SEAT,
  SEATS,
  SIDES,
  STEPS,
  U,
  P,
  clone,
  examples,
  plural,
} from "./data";
import { E } from "./loose";

export type State = any;
export interface World {
  mode: "draft" | "live" | "history";
  viewer: string;
  workspaces: { draft: State; live: State; history?: State };
  /** Counts example loads: the board frames itself again. */
  fit: number;
  toast: { id: number; text: string } | null;
  announcement: string;
}

let toastId = 0;

export const currentState = (world: World): State => world.workspaces[world.mode];
export const sysLabel = (id: string) => `${MAP[id].name} · #${id}`;
export const pastState = (entry: (typeof HISTORY)[number]): State =>
  (entry.state ||= Object.assign(E.makeState(entry.example), {
    past: { label: `R${entry.round} · ${entry.label}` },
    tip: "A past action from the log, read-only. It uses the same frame as Live and Draft.",
  }));

export function createWorld(): World {
  E.env.viewer = "sol";
  return {
    mode: "draft",
    viewer: "sol",
    workspaces: { draft: E.makeState("draft-combat"), live: E.makeState("live-combat") },
    fit: 0,
    toast: null,
    announcement: "",
  };
}

export function loadExample(world: World, example: string) {
  E.env.viewer = world.viewer;
  const state = E.makeState(example);
  world.toast = null;
  world.mode = state.mode;
  world.workspaces[state.mode as "draft" | "live"] = state;
  if (world.mode === "draft") world.viewer = E.env.viewer = "sol";
  world.fit++;
  E.normalize(state);
}

export function setViewer(world: World, viewer: string) {
  world.viewer = E.env.viewer = viewer;
  delete world.workspaces.history;
  // A seat change restarts the live example, so nobody inherits a half-made decision.
  world.workspaces.live = E.makeState(
    examples[world.workspaces.live.example] ? world.workspaces.live.example : "live-combat",
  );
  if (viewer !== "sol" || world.mode === "history") world.mode = "live";
  E.normalize(currentState(world));
}

export function resetExample(world: World) {
  const example = currentState(world).example;
  loadExample(world, examples[example] ? example : "live-combat");
  world.toast = { id: ++toastId, text: "This example has been reset." };
}

const battleActions: Record<string, (state: State, battle: any, data: any) => void> = {
  roll: (state, battle) => E.battleRoll(state, battle),
  announceRetreat: (state, battle) => {
    battle.announced[SIDES.find((side) => E.controls(state, side))!] = true;
  },
  playCard: (state, battle, data) => {
    const side = SIDES.find((name) => E.controls(state, name))!;
    battle.boost[side] = true;
    state.hands[SEAT[side]] = state.hands[SEAT[side]].filter((card: string) => card !== data.card);
  },
  stageHit: (_state, battle, data) => {
    if (battle.staged.length < battle.owed[battle.side])
      battle.staged.push({ type: data.unit, kind: data.kind });
  },
  resetHits: (_state, battle) => {
    battle.staged = [];
  },
  assignHits: (state, battle) => {
    E.applyActions(battle.forces[battle.side], battle.staged, battle.records.at(-1), battle.side);
    Object.assign(battle, { staged: [], stage: "hits" });
    battle.owed[battle.side] = 0;
    E.battleContinue(state, battle);
  },
  passReaction: (state, battle) => {
    Object.assign(battle, { reaction: null, stage: "hits" });
    E.battleContinue(state, battle);
  },
  playReaction: (state, battle) => {
    const { side, target, type } = battle.reaction;
    const rec = battle.records.at(-1);
    const unit = battle.forces[target][type];
    unit.n--;
    unit.dmg--;
    rec.dmg[target][type]--;
    rec.lost[target][type] = (rec.lost[target][type] || 0) + 1;
    rec.notes.push(
      `${P[SEAT[side as "att"]].name} played Direct Hit. The ${U[type as "carrier"].name} that sustained damage was destroyed.`,
    );
    state.hands[SEAT[side as "att"]] = state.hands[SEAT[side as "att"]].filter(
      (card: string) => card !== "Direct Hit",
    );
    Object.assign(battle, { reaction: null, stage: "hits" });
    E.battleContinue(state, battle);
  },
  pickRetreat: (_state, battle, data) => {
    battle.pick = data.destination;
  },
  retreat: (state, battle) => {
    battle.destination = battle.pick;
    E.endRound(state, battle);
  },
};

export function reduce(world: World, intent: Intent) {
  E.env.viewer = world.viewer;
  const state = currentState(world);
  const toast = (text: string) => (world.toast = { id: ++toastId, text });
  const announce = (text: string) => (world.announcement = text);
  const progress = () =>
    state.frontier === null ? "Action complete." : `Current step: ${STEPS[state.frontier]}.`;
  state.reveal = null;

  function selectStep(step: number | null) {
    if (state.kind !== "tactical") return void (state.selected = step);
    if (step === null || !E.isReached(state, step)) return;
    state.selected = step;
    announce(
      `Viewing ${STEPS[step]}. ${state.frontier === null ? "Action complete." : `Current step: ${STEPS[state.frontier]}.`}`,
    );
  }
  function battle(action: string, data: object = {}) {
    const open = E.activeBattle(state);
    if (!open) return;
    const frontier = state.frontier;
    state.rev = (state.rev || 0) + 1;
    battleActions[action](state, open, data);
    if (open.stage === "done")
      toast(
        open.kind === "space"
          ? "Space combat resolved. Its record stays in this step."
          : "Ground combat resolved.",
      );
    else if (action === "announceRetreat")
      toast("Retreat announced. Your ships leave after this round.");
    if (state.frontier !== frontier) announce(progress());
  }

  switch (intent.type) {
    case "selectStep":
      selectStep(intent.step);
      break;
    case "returnToCurrent":
      selectStep(state.frontier);
      break;
    case "returnToEdit":
      selectStep(state.edit.step);
      break;
    case "commitEdit": {
      if (!state.edit || E.validation(state)) break;
      const step = state.edit.step;
      if (step === 0 && state.edit.value.system !== state.data.activation.system)
        state.data.invasion = {};
      state.data[KEYS[step]!] = clone(state.edit.value);
      state.edit = null;
      E.commitStep(state, step);
      // Keep a fresh dice result on screen; otherwise follow the action.
      const results =
        state.mode === "live" &&
        ((step === 3 &&
          (Object.keys(state.inv.records).length || Object.keys(state.inv.battles).length)) ||
          (step === 1 && state.cannon));
      state.selected = results ? step : (state.frontier ?? step);
      state.inspect = state.data.activation.system;
      E.remember(state);
      toast(
        state.mode === "draft"
          ? `${STEPS[step]} drafted. Later steps rechecked.`
          : `${STEPS[step]} committed.`,
      );
      announce(
        state.frontier === null ? "All steps complete." : `Current step: ${STEPS[state.frontier]}.`,
      );
      break;
    }
    case "confirmApply": {
      const draft = world.workspaces.draft;
      if (world.mode !== "draft" || !E.canApply(draft) || draft.edit) break;
      const live = E.blankState("applied", "live", draft.route, draft.data);
      Object.assign(live, {
        stale: draft.stale,
        tip: "Your draft is now the live action. Recorded steps are read-only; the rest needs live decisions.",
      });
      // Replay the recorded choices until the live game needs something the draft could not hold.
      for (const step of [0, 1, 3, 4])
        if (draft.done[step] && live.frontier === step && live.blocker === "decision")
          E.commitStep(live, step);
      live.selected = live.frontier ?? 4;
      E.remember(live);
      world.workspaces.live = live;
      world.workspaces.draft = E.makeState("draft-start");
      world.mode = "live";
      toast("Draft applied. Continue in Live.");
      break;
    }
    case "battle":
      battle(intent.action);
      break;
    case "playCard":
      battle("playCard", intent);
      break;
    case "stageHit":
      battle("stageHit", intent);
      break;
    case "pickRetreat":
      battle("pickRetreat", intent);
      break;
    case "workspace":
      if (intent.mode !== "history" || world.workspaces.history) world.mode = intent.mode;
      break;
    case "simulate":
      if (state.kind === "tactical") {
        state.rev = (state.rev || 0) + 1;
        E.simulate(state);
      } else E.flowAdvance(state);
      break;
    case "undo":
    case "redo":
      E.travel(state, state.cursor + (intent.type === "undo" ? -1 : 1));
      break;
    case "startOver":
      world.workspaces.draft = E.makeState("draft-start");
      toast("Draft cleared. Choose a system to begin.");
      break;
    case "discardDraft":
      world.workspaces.draft = E.makeState("draft-start");
      world.mode = "live";
      toast("Draft discarded.");
      break;
    case "editStep": {
      const step = intent.step;
      if (state.mode !== "draft" || state.edit?.dirty || !E.isReached(state, step) || !KEYS[step])
        break;
      E.beginEdit(state, step);
      announce(`Editing ${STEPS[step]}. Changes are uncommitted.`);
      break;
    }
    case "cancelEdit":
      state.edit = null;
      toast("Changes dropped. The recorded choices are unchanged.");
      break;
    case "setCount":
    case "removeLine":
    case "setPlacement": {
      if (!state.edit) break;
      const path = intent.type === "setPlacement" ? `place.${intent.unit}` : intent.key;
      const value =
        intent.type === "setPlacement"
          ? intent.place
          : intent.type === "removeLine"
            ? Math.max(0, E.available(state, state.edit.value, path))
            : Math.max(0, intent.value);
      E.put(state.edit.value, path, value);
      state.edit.dirty = true;
      announce(E.validation(state) || "Selection updated.");
      break;
    }
    case "inspectSystem":
      state.inspect = intent.system;
      if (state.edit?.step === 0 && state.selected === 0)
        Object.assign(state.edit, { value: { system: state.inspect }, dirty: true });
      if (state.edit?.step === 1 && ORIGIN_IDS.includes(state.inspect)) {
        state.open[state.inspect] = true;
        state.reveal = `sys:${state.inspect}`;
      }
      break;
    case "expandOrigin":
      state.open[intent.system] = true;
      state.inspect = intent.system;
      break;
    case "closeInspector":
      state.inspect = null;
      break;
    case "togglePlanet":
      if (state.kind === "tactical") {
        if (state.edit?.step !== 4) break;
        state.edit.value.pay[intent.planet] = !state.edit.value.pay[intent.planet];
        state.edit.dirty = true;
        state.reveal = `pl:${intent.planet}`;
        announce(E.validation(state) || "Payment staged.");
      } else if (state.kind === "strategic") {
        state.flow.mine.pay[intent.planet] = !state.flow.mine.pay[intent.planet];
        state.reveal = `pl:${intent.planet}`;
      } else if (state.kind === "component") {
        state.flow.target = intent.planet;
        state.reveal = `pl:${intent.planet}`;
      }
      break;
    case "setPayment":
      if (state.kind === "strategic") {
        state.flow.mine.pay[intent.source] = intent.on;
        announce(E.flowProblem(state) || "Payment staged.");
      } else if (state.edit?.step === 4) {
        state.edit.value.pay[intent.source] = intent.on;
        state.edit.dirty = true;
        announce(E.validation(state) || "Payment staged.");
      }
      break;
    case "chooseRoute":
      if (state.edit?.step !== 1) break;
      state.edit.value["@" + intent.line] = intent.index;
      state.edit.dirty = true;
      announce(E.validation(state) || "Route changed.");
      break;
    case "findSystem": {
      const text = intent.query.trim().toLowerCase();
      const id = text.match(/#?(\d+)$/)?.[1];
      const ids = Object.keys(MAP);
      const found =
        id && MAP[id]
          ? id
          : ids.find((other) => text && MAP[other].name.toLowerCase().startsWith(text)) ||
            ids.find((other) => text && MAP[other].name.toLowerCase().includes(text));
      if (!found || state.edit?.step !== 0) {
        announce("No system has this name or number.");
        break;
      }
      Object.assign(state.edit, { value: { system: found }, dirty: true });
      state.inspect = found;
      announce(`${sysLabel(found)} selected. ${E.validation(state)}`);
      break;
    }
    case "inspectLogEntry":
      world.workspaces.history = pastState(HISTORY.find((entry) => entry.id === intent.id)!);
      world.mode = "history";
      break;
    case "closeHistory":
      delete world.workspaces.history;
      world.mode = "live";
      break;
    case "pickAction":
      if (intent.action === "tactical") {
        const system = intent.system || null;
        Object.assign(state, {
          kind: "tactical",
          picked: true,
          tip: "A tactical action is staged. Nothing is spent until you activate. Click a different system to change it.",
        });
        E.beginEdit(state, 0);
        Object.assign(state.edit, { value: { system }, dirty: !!system });
        if (system) state.inspect = system;
      } else
        world.workspaces.live = E.makeState(
          intent.action === "strategic" ? "live-strategic" : "live-component",
        );
      break;
    case "backToPicker":
      Object.assign(state, { kind: "picker", edit: null, selected: 0 });
      break;
    case "flowCount":
      E.put(state.flow.mine, intent.key, Math.max(0, intent.value));
      announce(E.flowProblem(state) || "Selection updated.");
      break;
    case "flowTarget":
      state.flow.target = intent.planet;
      state.reveal = `pl:${intent.planet}`;
      break;
    case "flow": {
      const flow = state.flow;
      if (intent.action === "play") {
        const source = PAY.find((item) => item.id === flow.target)!;
        Object.assign(flow, {
          stage: "done",
          result: `Jamie gained ${plural(source.res, "trade good")} for ${source.label.replace("Exhaust ", "")}. Trade goods ${SEATS.sol.tg} → ${SEATS.sol.tg + source.res}.`,
        });
        toast("Mining Initiative resolved.");
      } else if (intent.action === "ready") {
        flow.mine.ready = true;
        toast("Draft ready. It resolves when your seat is reached.");
        E.settle(state);
      } else if (intent.action === "change") flow.mine.ready = false;
      else {
        if (E.flowProblem(state)) break;
        if (flow.stage === "primary")
          Object.assign(flow, {
            stage: "secondary",
            primaryResult: `Jamie gained 3 command tokens${flow.mine.buy ? ` and bought ${flow.mine.buy} for ${flow.mine.buy * 3} influence` : ""}.`,
          });
        else E.resolveMine(state);
        E.settle(state);
        toast(
          `${flow.card} ${flow.stage === "secondary" ? "primary resolved. Secondaries follow in seat order." : "secondary resolved."}`,
        );
      }
      break;
    }
    case "openApply":
      break;
  }
  for (const text of E.env.toasts.splice(0)) toast(text);
  E.normalize(currentState(world));
}
