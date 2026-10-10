// The board: one tile for each system on the map, and the inspector of one system.
import type {
  Anomaly,
  BoardTaskView,
  BoardView,
  Force,
  InspectorRowView,
  InspectorView,
  SeatId,
  TileView,
  UnitType,
} from "../../model";
import type { MovementDraft } from "../movementDraft";
import type {
  BoardTileView,
  MovementFacts,
  PlacedUnitView,
  SessionUpdate,
  SystemView,
} from "../wire";
import { selectArrival, selectMovementBoard, selectOrigin, withMovement } from "./movement";
import {
  ANOMALIES,
  TECH_COLORS,
  UNIT_ORDER,
  WORMHOLES,
  isGroundForce,
  isShip,
  unitType,
} from "./names";

const viewerSeat = (update: SessionUpdate) =>
  update.viewer.role === "player" ? update.viewer.seat : null;

/** The units of one owner in one place, counted by type, in display order. */
function force(units: PlacedUnitView[]): Force {
  const counts = new Map<UnitType, { count: number; damaged: number }>();
  for (const unit of units) {
    const type = unitType(unit.unit_type);
    if (type) {
      const entry = counts.get(type) ?? { count: 0, damaged: 0 };
      entry.count++;
      entry.damaged += unit.damaged ? 1 : 0;
      counts.set(type, entry);
    }
  }
  return UNIT_ORDER.flatMap((unit) => {
    const entry = counts.get(unit);
    return entry ? [{ unit, ...entry }] : [];
  });
}

const seatsOf = (units: PlacedUnitView[]): SeatId[] => [...new Set(units.map((u) => u.owner))];
const shipsIn = (system: SystemView | undefined) =>
  (system?.units ?? []).filter((unit) => {
    const type = unitType(unit.unit_type);
    return unit.planet === null && type !== null && isShip(type);
  });
const onPlanet = (system: SystemView | undefined, planet: string) =>
  (system?.units ?? []).filter((unit) => unit.planet === planet);

/** Systems outside the map (the wormhole nexus, the fracture) have no place on this board yet. */
const onMap = (tile: BoardTileView) => !tile.special_area;

function tileView(tile: BoardTileView, system: SystemView | undefined, viewer: string | null) {
  const ships = shipsIn(system);
  const fleets = seatsOf(ships).map((seat) => ({
    seat,
    ships: ships.filter((unit) => unit.owner === seat).length,
    // Hits per round is a rule. It comes from the engine later.
    strength: 0,
  }));
  const anomaly = (tile.anomalies ?? [])
    .map((name) => ANOMALIES[name as keyof typeof ANOMALIES] as Anomaly | undefined)
    .find(Boolean);
  const wormhole = tile.wormholes?.[0];
  const view: TileView = {
    id: tile.system_id,
    name: tile.label,
    q: tile.q,
    r: tile.r,
    // The view does not say whose home a system is.
    home: null,
    anomaly: anomaly ?? null,
    wormhole: wormhole ? (WORMHOLES[wormhole] ?? wormhole) : null,
    commandToken: viewer !== null && !!system?.command_tokens.includes(viewer),
    planets: (tile.planets ?? []).slice(0, 3).map((planet) => {
      const units = onPlanet(system, planet.id);
      const types = units.map((unit) => unitType(unit.unit_type));
      return {
        id: planet.id,
        name: planet.label,
        resources: planet.resources,
        influence: planet.influence,
        owner: system?.planets[planet.id]?.controlled_by ?? null,
        tech: TECH_COLORS[planet.tech_specialties?.[0] ?? ""] ?? null,
        groundForces: types.filter((type) => type && isGroundForce(type)).length,
        planetaryShield: types.includes("pds"),
      };
    }),
    control: fleets.length > 1 ? "contested" : (fleets[0]?.seat ?? null),
    fleets,
    pickedUp: 0,
  };
  return view;
}

function inspector(
  tile: BoardTileView,
  system: SystemView | undefined,
  viewer: string | null,
): InspectorView {
  const ships = shipsIn(system);
  const space: InspectorRowView[] = seatsOf(ships).map((seat) => ({
    seat,
    force: force(ships.filter((unit) => unit.owner === seat)),
  }));
  const planets = (tile.planets ?? []).map((planet): InspectorRowView => {
    const units = onPlanet(system, planet.id);
    return {
      planet: {
        name: planet.label,
        resources: planet.resources,
        influence: planet.influence,
        owner: system?.planets[planet.id]?.controlled_by ?? null,
      },
      force: force(units),
      notes: system?.planets[planet.id]?.exhausted ? [{ text: "Exhausted", tone: "muted" }] : [],
    };
  });
  const tokens = system?.command_tokens ?? [];
  const facts = [
    ...(tile.anomalies ?? []).map((name) => name.charAt(0).toUpperCase() + name.slice(1)),
    ...(tile.wormholes ?? []).map((name) => `${WORMHOLES[name] ?? name} wormhole`),
    tile.hyperlane ? "Hyperlane" : "",
    viewer !== null && tokens.includes(viewer) ? "Your command token is here" : "",
  ].filter(Boolean);
  return {
    system: tile.system_id,
    title: `${tile.label} · ${tile.system_id}`,
    facts: facts.join(" · ") || "No anomaly",
    notes: [],
    rows: [...(space.length ? space : [{ label: "In space", text: "No ships" }]), ...planets],
    activate: null,
  };
}

export function selectBoard(
  update: SessionUpdate,
  inspected: string | null,
  task: BoardTaskView | null,
  /** The open movement step: the board shows what is staged, and a system opens its fleet. */
  movement: { facts: MovementFacts; draft: MovementDraft } | null = null,
): BoardView {
  const viewer = viewerSeat(update);
  const board = update.view.board;
  const map = (board.map_tiles ?? []).filter(onMap);
  const open = map.find((tile) => tile.system_id === inspected);
  const marks = map.flatMap((tile) =>
    (tile.wormholes ?? []).map((kind) => [kind, tile.system_id] as const),
  );
  const move =
    movement &&
    selectMovementBoard(update, movement.facts, movement.draft, open?.system_id ?? null);
  const origin =
    movement && selectOrigin(update, movement.facts, movement.draft, open?.system_id ?? null);
  const tiles = map.map((tile) => tileView(tile, board.systems[tile.system_id], viewer));
  return {
    tiles: move ? tiles.map((tile) => withMovement(tile, move)) : tiles,
    wormholes: marks.flatMap(([kind, id]) =>
      marks
        .filter(([other, otherId]) => other === kind && otherId > id)
        .map(([, otherId]): [string, string] => [id, otherId]),
    ),
    routes: move?.routes ?? [],
    activeSystem: board.active_system ?? null,
    inspected: open ? open.system_id : null,
    targeting: false,
    task,
    // The fleet with its controls takes the place of the inspector of that system.
    inspector:
      open && !origin
        ? {
            ...inspector(open, board.systems[open.system_id], viewer),
            ...(movement && open.system_id === movement.facts.active
              ? { arriving: selectArrival(update, movement.facts, movement.draft) }
              : {}),
          }
        : null,
    origin: origin ?? null,
    taskSystems: move ? move.systems : task ? (task.highlight ?? Object.keys(task.values)) : [],
    // The board is framed again for each movement: its systems are the task.
    fitKey: movement ? `movement:${movement.facts.active}` : "local",
  };
}
