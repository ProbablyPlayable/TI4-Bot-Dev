// The board: tiles, routes, what the open task lets the player choose on planets, the inspector.
import type {
  BoardView,
  InspectorRowView,
  InspectorView,
  BoardTaskView,
  TechColor,
  TileView,
  UnitType,
} from "../../model";
import { plural } from "../../model";
import { ANOMALY, LINES, MAP, PAY, RETREATS, SCRIPTED, STEPS, TECH, U } from "../data";
import { E } from "../loose";
import { strategyEditor } from "../strategy";
import { decisionShape, sysLabel, type State, type World } from "../world";
import {
  countsForce,
  isTactical,
  mapStep,
  productionPayment,
  stepCaption,
  toForce,
} from "./shared";

function boardTask(world: World, state: State): BoardTaskView | null {
  if (world.mode === "history") {
    return null;
  }
  if (decisionShape(state) === "system") {
    return {
      target: "system",
      kind: "pick",
      interactive: true,
      values: Object.fromEntries(
        Object.keys(MAP)
          .filter((id) => MAP[id].token)
          .map((id) => [id, 0]),
      ),
      chosen: state.flow.chosen ? { [state.flow.chosen]: true } : {},
      verb: "Choose",
      unit: "system",
    };
  }
  const values = (key: "res" | "inf") =>
    Object.fromEntries(
      PAY.filter((source) => source.system).map((source) => [source.id, source[key]!]),
    );
  if (isTactical(state)) {
    // A retreat: the destination is a system, so the board is where it is chosen.
    const battle = state.mode === "live" ? E.activeBattle(state) : null;
    if (battle?.stage === "retreat" && E.controls(state, battle.side)) {
      return {
        target: "system",
        kind: "pick",
        interactive: true,
        values: Object.fromEntries(RETREATS[battle.side as "att"].map((id) => [id, 0])),
        chosen: battle.pick ? { [battle.pick]: true } : {},
        verb: "Retreat to",
        unit: "system",
      };
    }
    if (mapStep(state) === 4) {
      return {
        payment: productionPayment(state) ?? undefined,
        values: values("res"),
        chosen: state.edit.value.pay,
        interactive: true,
        verb: "Exhaust",
        unit: "resource",
        kind: "pay",
        target: "planet",
      };
    }
    return state.done[4]
      ? {
          values: {},
          chosen: state.data.production.pay,
          interactive: false,
          verb: "",
          unit: "",
          kind: "pay",
          target: "planet",
        }
      : null;
  }
  const flow = state.flow;
  if (state.kind === "strategic") {
    return E.flowEditing(state) ? strategyEditor(state, world.table.seats).task : null;
  }
  if (E.own() && state.kind === "component" && flow.stage === "target") {
    return {
      values: values("res"),
      chosen: flow.target ? { [flow.target]: true } : {},
      interactive: true,
      verb: "Choose",
      unit: "resource",
      kind: "pick",
      target: "planet",
    };
  }
  return null;
}

function inspector(world: World, state: State): InspectorView | null {
  const id: string | null = state.inspect;
  if (!id) {
    return null;
  }
  const system = MAP[id];
  const draft = state.mode === "draft";
  const partner =
    system.wormhole &&
    Object.keys(MAP).find((other) => other !== id && MAP[other].wormhole === system.wormhole);
  const here = isTactical(state) && state.done[0] && id === E.activeId(state);
  const activate =
    state.kind === "picker" && world.mode === "live" && world.viewer === "sol"
      ? system.token
        ? "token"
        : "allowed"
      : null;
  const facts = [
    here ? `Active system · ${draft ? "latest preview" : "live board"}` : system.note,
    system.anomaly && ANOMALY[system.anomaly].label,
    system.wormhole && `${system.wormhole} wormhole`,
    system.token && "Your command token is here",
  ]
    .filter(Boolean)
    .join(" · ");
  const notes = [
    system.anomaly ? ANOMALY[system.anomaly].rule : "",
    partner ? `Adjacent to ${sysLabel(partner)} through the wormhole.` : "",
  ].filter(Boolean);
  const base = { system: id, title: sysLabel(id), facts: facts || "No anomaly", notes };
  const planetHead = (planet: any) => ({
    name: planet.name,
    resources: planet.res,
    influence: planet.inf,
    owner: planet.owner,
  });
  if (!here) {
    const moved =
      state.edit?.step === 1 ? state.edit.value : state.done[1] ? state.data.movement : {};
    const taken = (line: any) =>
      E.stagedEntries(moved)
        .filter((entry: any) => entry.line === line)
        .reduce((sum: number, entry: any) => sum + entry.count, 0);
    const left = LINES.filter((line) => line.origin === id)
      .map((line) => [line, line.n - taken(line)] as const)
      .filter(([, count]) => count > 0);
    const fleets = E.others(state, id);
    const rows: InspectorRowView[] = [
      ...(left.length
        ? [
            {
              seat: "sol",
              text: left
                .map(
                  ([line, count]) =>
                    `${count} ${line.label || E.unitName(line.type, count)}${line.damaged ? " (damaged)" : ""}`,
                )
                .join(" · "),
            },
          ]
        : []),
      ...Object.keys(fleets).map((seat) => ({ seat, force: countsForce(fleets[seat]) })),
      ...E.planetsOf(state, id).map((planet: any) => ({
        planet: planetHead(planet),
        notes:
          planet.owner && planet.owner !== "sol"
            ? [{ text: plural(planet.troops || 2, "ground force"), tone: "muted" as const }]
            : [],
      })),
    ];
    return { ...base, rows, activate };
  }
  const carrying = [
    state.ground.infantry && `${state.ground.infantry} Infantry`,
    state.ground.mech && plural(state.ground.mech, "Mech"),
  ]
    .filter(Boolean)
    .join(" · ");
  const space: InspectorRowView[] = [];
  if (E.size(state.fleet) || carrying) {
    space.push({
      seat: "sol",
      force: toForce(state.fleet),
      notes: carrying ? [{ text: `Carrying ${carrying}`, tone: "muted" }] : [],
    });
  }
  if (E.size(state.enemyFleet)) {
    space.push({ seat: "hacan", force: toForce(state.enemyFleet) });
  }
  if (!space.length) {
    space.push({ label: "In space", text: "No ships" });
  }
  const planets = state.planets.map((planet: any): InspectorRowView => {
    const plan = draft && state.done[3] ? E.landed(state, planet.id) : {};
    const structures = planet.structures
      .map((type: UnitType) => U[type].name + (type === "pds" ? " · Planetary Shield" : ""))
      .join(" · ");
    return {
      planet: planetHead(planet),
      force: toForce(planet.units),
      notes: [
        ...(structures ? [{ text: structures, tone: "muted" as const }] : []),
        ...(E.size(plan) ? [{ text: `+ ${E.list(plan)} planned`, tone: "planned" as const }] : []),
      ],
    };
  });
  return { ...base, rows: [...space, ...planets], activate: null };
}

function latestResult(world: World, state: State): string {
  if (world.mode === "history") {
    return "Board: the result of this action (demo). The real board stays on the present state.";
  }
  if (isTactical(state)) {
    const last = [4, 3, 2, 1, 0].find((step) => state.done[step] && !state.skipped[step]);
    if (last !== undefined) {
      return `Jamie · ${STEPS[last]} · ${stepCaption(state, last, "done")}${state.mode === "draft" ? " (draft)" : ""}`;
    }
  }
  return "Blair gained 3 trade goods with Mining Initiative.";
}

export function selectBoard(world: World, state: State): BoardView {
  const step = mapStep(state);
  const tactical = isTactical(state);
  const active: string | null = !tactical
    ? null
    : step === 0
      ? state.edit.value.system
      : E.activeId(state);
  const moving = !tactical
    ? {}
    : step === 1
      ? state.edit.value
      : state.done[1]
        ? state.data.movement
        : {};
  const entries: any[] = E.stagedEntries(moving);
  const taken = (line: any) =>
    entries.filter((entry) => entry.line === line).reduce((sum, entry) => sum + entry.count, 0);
  const hits = (group: any) =>
    (E.types(group) as UnitType[]).reduce(
      (sum, type) => sum + (group[type].n * (11 - U[type].combat!)) / 10,
      0,
    );
  const shipCount = (counts: Record<string, number>) =>
    Object.keys(counts).reduce(
      (sum, type) => sum + (U[type as UnitType].ship ? counts[type] : 0),
      0,
    );

  const tiles = Object.keys(MAP).map((id): TileView => {
    const system = MAP[id];
    const here = tactical && state.done[0] && id === E.activeId(state);
    const solCounts: Record<string, number> = here
      ? Object.fromEntries(E.types(state.fleet).map((type: string) => [type, state.fleet[type].n]))
      : Object.fromEntries(
          [
            ...new Set(
              LINES.filter(
                (line) => line.origin === id && (U[line.type].ship || line.type === "fighter"),
              ).map((line) => line.type),
            ),
          ].map((type) => [
            type,
            LINES.filter((line) => line.origin === id && line.type === type).reduce(
              (sum, line) => sum + line.n - taken(line),
              0,
            ),
          ]),
        );
    const fleets: Record<string, Record<string, number>> = {
      ...(shipCount(solCounts) ? { sol: solCounts } : {}),
      ...E.others(state, id),
    };
    const marks = Object.keys(fleets)
      .map((seat) => ({
        seat,
        ships: shipCount(fleets[seat]),
        strength: hits(E.force(fleets[seat])),
      }))
      .filter((mark) => mark.ships);
    const troops = (planet: any) =>
      here
        ? E.size(planet.units, (type: UnitType) => U[type].ground)
        : planet.owner === "sol"
          ? LINES.filter((line) => line.origin === id && line.from === planet.name).reduce(
              (sum, line) => sum + line.n - taken(line),
              0,
            )
          : planet.owner
            ? planet.troops || 2
            : 0;
    return {
      id,
      name: system.name,
      q: system.q,
      r: system.r,
      home: system.home ?? null,
      anomaly: system.anomaly ?? null,
      wormhole: system.wormhole ?? null,
      commandToken: !!system.token,
      planets: E.planetsOf(state, id).map((planet: any) => ({
        id: planet.id,
        name: planet.name,
        resources: planet.res,
        influence: planet.inf,
        owner: planet.owner,
        tech: (TECH[planet.id] as TechColor) ?? null,
        groundForces: troops(planet),
        planetaryShield: !!(here && planet.structures?.includes("pds")),
      })),
      control: marks.length > 1 ? "contested" : (marks[0]?.seat ?? null),
      fleets: marks,
      pickedUp: entries
        .filter((entry) => entry.key.includes(">") && entry.line.origin === id)
        .reduce((sum, entry) => sum + entry.count, 0),
    };
  });

  const ids = Object.keys(MAP);
  const wormholes = ids
    .filter((id) => MAP[id].wormhole)
    .flatMap((id) =>
      ids
        .filter((other) => other > id && MAP[other].wormhole === MAP[id].wormhole)
        .map((other) => [id, other] as [string, string]),
    );
  const lines =
    !tactical || state.selected !== 1 || !state.done[0]
      ? []
      : LINES.filter((line) => U[line.type].ship && E.moveInfo(state, line).routes.length);
  // The systems of the open task: where the player's units and planets are, and the active system.
  const taskActive = tactical
    ? state.edit?.step === 0
      ? state.edit.value.system
      : E.activeId(state)
    : null;
  const taskSystems = [
    ...new Set([
      ...LINES.map((line) => line.origin),
      ...PAY.filter((source) => source.system).map((source) => source.system!),
      ...SCRIPTED,
      ...(taskActive ? [taskActive] : []),
    ]),
  ];

  // A table with fewer seats: the other factions are not in the game, so the board is neutral there.
  const seats = world.table.seats;
  const plays = (seat: string | null | undefined) => !seat || seats.includes(seat);
  const inspected = inspector(world, state);
  if (seats.length < 8) {
    for (const tile of tiles) {
      tile.fleets = tile.fleets.filter((fleet) => plays(fleet.seat));
      tile.control = tile.fleets.length > 1 ? "contested" : (tile.fleets[0]?.seat ?? null);
      if (!plays(tile.home)) {
        tile.home = null;
      }
      for (const planet of tile.planets) {
        if (!plays(planet.owner)) {
          Object.assign(planet, { owner: null, groundForces: 0 });
        }
      }
    }
    if (inspected) {
      inspected.rows = inspected.rows.filter((row) => plays(row.seat));
      for (const row of inspected.rows) {
        if (row.planet && !plays(row.planet.owner)) {
          Object.assign(row, { notes: [] }).planet!.owner = null;
        }
      }
    }
  }

  return {
    tiles,
    wormholes,
    routes: lines.map((line) => ({
      id: line.id,
      path: E.chosen(state, moving, line),
      staged: moving[line.id] > 0,
    })),
    activeSystem: active,
    inspected: state.inspect,
    targeting: step === 0,
    task: boardTask(world, state),
    inspector: inspected,
    taskSystems,
    fitKey: `${world.fit}`,
    latestResult: latestResult(world, state),
  };
}
