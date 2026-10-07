// Small derivations that several selectors share: forces, captions, who must act.
import type { ActionButtonView, Force, Intent, SeatId, SeatView, UnitType } from "../../model";
import { MAP, P, SEAT, SEATS, STEPS, plural } from "../data";
import { E } from "../loose";
import type { State, World } from "../world";

export type Group = Partial<Record<UnitType, { n: number; dmg: number }>>;

export const toForce = (group: Group): Force =>
  (E.types(group) as UnitType[]).map((unit) => ({
    unit,
    count: group[unit]!.n,
    damaged: group[unit]!.dmg,
  }));
export const countsForce = (counts: Partial<Record<UnitType, number>>): Force =>
  toForce(E.force(counts));

export const seatViews: Record<SeatId, SeatView> = Object.fromEntries(
  Object.entries(SEATS).map(([id, seat]) => [
    id,
    { id, name: seat.name, faction: seat.faction, symbol: seat.symbol, color: seat.color },
  ]),
);

export const isTactical = (state: State) => state.kind === "tactical";
export const systemName = (state: State) => MAP[state.data.activation.system].name;
export const waitingFor = (state: State): string => E.waitingFor(state);
export const mine = (state: State): boolean => E.mine(state);

export const button = (
  intent: Intent,
  label: string,
  tone: ActionButtonView["tone"] = "quiet",
  disabled = false,
  arrow = false,
): ActionButtonView => ({ intent, label, tone, disabled, arrow });

export function stepCaption(state: State, step: number, status: string): string {
  if (status === "future") return "";
  if (status === "skipped") return `Skipped · ${state.skipped[step]}`;
  if (status === "boundary") return "Preview ends here";
  if (status === "needs-review") return "Needs review";
  if (status === "decision")
    return state.mode === "draft"
      ? "Preparing"
      : mine(state)
        ? "Your decision"
        : `Waiting for ${waitingFor(state)}`;
  const draft = state.mode === "draft";
  if (step === 0) return `#${state.data.activation.system} ${systemName(state)}`;
  if (step === 1) {
    const moved = E.originTotals(state.data.movement);
    return `${plural(moved.ships, "ship")} · ${moved.cargo} cargo`;
  }
  if (step === 2) {
    const battle = state.battle;
    if (battle.stage !== "done")
      return `Round ${battle.round} · ${mine(state) ? "your decision" : "waiting"}`;
    return `${battle.winner ? P[SEAT[battle.winner as "att"]].faction + " won" : "Both fleets destroyed"} · ${plural(battle.round, "round")}`;
  }
  if (step === 3) {
    if (status === "battle") return "Ground combat";
    const count = state.planets.reduce(
      (sum: number, planet: any) => sum + E.size(E.landed(state, planet.id)),
      0,
    );
    if (draft) return `${count} planned to land`;
    const result = (kind: string) =>
      state.planets.find((planet: any) => state.inv.results[planet.id] === kind)?.name;
    return result("captured")
      ? `${result("captured")} captured`
      : result("held")
        ? `${result("held")} held by Hacan`
        : result("claimed")
          ? `${result("claimed")} claimed`
          : `${count} landed`;
  }
  const total = E.productionTotals(state, state.data.production);
  return `${plural(total.count, "unit")} · ${plural(total.cost, "resource")}`;
}

export function statusText(world: World, state: State): string {
  if (world.mode === "history") return "Viewing a past action";
  if (isTactical(state)) {
    const draft = state.mode === "draft";
    const done = state.frontier === null;
    return draft
      ? "Your turn · Preparing a tactical action"
      : done
        ? "Tactical action complete"
        : mine(state)
          ? `Your decision · ${E.need(state).what}`
          : `Waiting for ${waitingFor(state)} · ${E.need(state).what}`;
  }
  const wait = E.flowNeed(state);
  if (!wait) return `${state.kind === "strategic" ? "Strategic" : "Component"} action complete`;
  if (state.kind === "picker") return "Your turn · Choose an action";
  return wait.mine
    ? `Your decision · ${wait.text}`
    : `Waiting for ${SEATS[wait.seat].name} · ${wait.text}`;
}

/** One line per stage: for a tactical action these are the stepper captions. */
export function stagesOf(state: State): [string, string][] {
  if (isTactical(state))
    return STEPS.map(
      (name, step) =>
        [name, stepCaption(state, step, E.stepState(state, step))] as [string, string],
    ).filter(([, text]) => text);
  const flow = state.flow;
  if (state.kind === "component") return [[flow.card, flow.result || "In progress"]];
  return [
    ["Primary", flow.primaryResult || "In progress"],
    ...flow.order
      .filter((seat: string) => flow.results[seat])
      .map(
        (seat: string) =>
          [`${SEATS[seat].name} · secondary`, flow.results[seat]] as [string, string],
      ),
  ];
}

export function summaryOf(state: State): string {
  if (state.kind !== "strategic")
    return stagesOf(state)
      .map(([, text]) => text)
      .join(" · ");
  const flow = state.flow;
  return [
    flow.primaryResult || "Primary in progress",
    ...flow.order
      .filter((seat: string) => flow.results[seat])
      .map(
        (seat: string) => `${SEATS[seat].name} ${flow.results[seat].split(" · ")[0].toLowerCase()}`,
      ),
  ].join(" · ");
}

/** The step being edited in view decides what the map shows. */
export const mapStep = (state: State): number | null =>
  state.edit && state.edit.step === state.selected && [0, 1, 4].includes(state.edit.step)
    ? state.edit.step
    : null;
