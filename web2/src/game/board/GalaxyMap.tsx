import { memo, useMemo, type KeyboardEvent, type RefObject } from "react";
import type {
  BoardView,
  PlanetMarkView,
  PlanetTaskView,
  RouteView,
  SystemId,
  TileView,
} from "../../model";
import { plural } from "../../model";
import { cx } from "../../ui";
import { useDispatch, useSeats } from "../context";
import { useLink } from "../link";
import { HEX_R, hexCenter, hexPoints, routePath } from "./hex";

export type MapViewId = "standard" | "economy" | "space" | "ground" | "tech";

const ANOMALY_LABEL = {
  asteroid: "Asteroid field",
  supernova: "Supernova",
  nebula: "Nebula",
  rift: "Gravity rift",
};
const TECH_COLOR = { B: "#7fb2f0", G: "#8dd2b0", Y: "#e6c15c", R: "#f3a098" };

function AnomalyGlyph({ kind }: { kind: keyof typeof ANOMALY_LABEL }) {
  if (kind === "rift")
    return (
      <>
        <circle r="12" fill="none" stroke="#b79cf0" strokeWidth="1.2" strokeDasharray="3 3" />
        <circle r="6.5" fill="none" stroke="#b79cf0" strokeWidth="1.2" />
        <circle r="2" fill="#b79cf0" />
      </>
    );
  if (kind === "asteroid")
    return (
      <path
        d="m-11-3 5-5 6 2 1 6-5 4-6-2Zm14 1 5-2 4 4-3 5-5-1Zm-6 9 4 1 1 4-4 2-3-3Z"
        fill="#59677a"
        stroke="#93a2b6"
        strokeWidth=".8"
      />
    );
  if (kind === "supernova")
    return (
      <>
        <circle r="7" fill="#f2a65a" fillOpacity=".85" />
        <path
          d="M0-14v5m0 18v5m-14-14h5m18 0h5m-20-10 3.5 3.5m13 13 3.5 3.5m0-20-3.5 3.5m-13 13-3.5 3.5"
          stroke="#f2a65a"
          strokeWidth="1.3"
          fill="none"
        />
      </>
    );
  return (
    <>
      <circle cx="-6" cy="1" r="8" fill="#c583c9" fillOpacity=".28" />
      <circle cx="5" cy="-3" r="9" fill="#c583c9" fillOpacity=".28" />
      <circle cx="4" cy="6" r="6" fill="#c583c9" fillOpacity=".28" />
    </>
  );
}

const pressOnKey = (event: KeyboardEvent<SVGGElement>) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

function Planet({
  planet,
  x,
  y,
  view,
  task,
}: {
  planet: PlanetMarkView;
  x: number;
  y: number;
  view: MapViewId;
  task: PlanetTaskView | null;
}) {
  const dispatch = useDispatch();
  const seats = useSeats();
  const { linked, props } = useLink([`pl:${planet.id}`]);
  const payable = !!task?.interactive && planet.id in task.values;
  const chosen = !!task?.chosen[planet.id];
  const color = planet.owner ? seats[planet.owner].color : undefined;
  const text = (body: React.ReactNode, size = 10, fill?: string) => (
    <text x={x} y={y + size * 0.35} fontSize={size} style={fill ? { fill } : undefined}>
      {body}
    </text>
  );
  // A planet that the task can use keeps its value when chosen. A ring and a check mark show the choice.
  const inside = payable
    ? text(task.values[planet.id])
    : view === "economy"
      ? text(
          <>
            <tspan style={{ fill: "var(--color-gold)" }}>{planet.resources}</tspan>
            <tspan style={{ fill: "var(--color-faint)" }}>/</tspan>
            <tspan style={{ fill: "var(--color-cyan)" }}>{planet.influence}</tspan>
          </>,
          8,
        )
      : view === "ground"
        ? text(`${planet.groundForces}${planet.planetaryShield ? "◈" : ""}`, 9)
        : view === "tech"
          ? planet.tech && text(planet.tech, 10, TECH_COLOR[planet.tech])
          : planet.owner
            ? text(seats[planet.owner].symbol, 8, color)
            : null;
  const button = payable
    ? {
        role: "button",
        tabIndex: 0,
        "aria-pressed": chosen,
        "aria-label": `${task.verb} ${planet.name}, ${task.values[planet.id]} ${task.unit}`,
        onKeyDown: pressOnKey,
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation();
          dispatch({ type: "togglePlanet", planet: planet.id });
        },
      }
    : {};
  return (
    <g
      className={cx(
        "planet",
        !planet.owner && "free",
        chosen && (payable ? (task.kind === "pay" ? "chosen" : "chosen picked") : "exhausted"),
        linked && "linked",
      )}
      style={color ? ({ "--seat": color } as React.CSSProperties) : undefined}
      {...props}
      {...button}
    >
      <title>
        {planet.name} · {planet.resources} resources / {planet.influence} influence
        {planet.owner ? " · " + seats[planet.owner].faction : ""}
      </title>
      <circle cx={x} cy={y} r="10" />
      {inside}
      {chosen && payable && (
        <g className="chosen-badge" transform={`translate(${x + 8} ${y - 8})`}>
          <circle r="4.6" />
          <path d="m-2.2 0 1.6 1.7 2.8-3.2" />
        </g>
      )}
    </g>
  );
}

interface TileProps {
  tile: TileView;
  active: boolean;
  inspected: boolean;
  targeting: boolean;
  view: MapViewId;
  task: PlanetTaskView | null;
}

const Tile = memo(function Tile({ tile, active, inspected, targeting, view, task }: TileProps) {
  const dispatch = useDispatch();
  const seats = useSeats();
  const { linked, props } = useLink([`sys:${tile.id}`]);
  const { x, y } = hexCenter(tile);
  const names = tile.name.toUpperCase().split(" / ");
  const strength = view === "space";
  const keep = active || !!tile.home || tile.landmark || inspected;
  const label = `${tile.name}, system ${tile.id}${tile.home ? `, ${seats[tile.home].faction} home system` : ""}${tile.anomaly ? ", " + ANOMALY_LABEL[tile.anomaly] : ""}${tile.wormhole ? `, ${tile.wormhole} wormhole` : ""}${tile.commandToken ? ", your command token is here" : ""}${tile.fleets.map((fleet) => `, ${plural(fleet.ships, seats[fleet.seat].faction + " ship")}`).join("")}`;
  return (
    <g
      className={cx(
        "system",
        tile.home && "home",
        inspected && "inspected",
        active && "active",
        (tile.anomaly === "asteroid" || tile.anomaly === "supernova") && "blocked",
        linked && "linked",
      )}
      style={tile.home ? ({ "--seat": seats[tile.home].color } as React.CSSProperties) : undefined}
      role="button"
      tabIndex={0}
      aria-label={`${targeting && !tile.commandToken ? "Activate" : "Inspect"} ${label}`}
      onKeyDown={pressOnKey}
      onClick={() => dispatch({ type: "inspectSystem", system: tile.id })}
      {...props}
    >
      <polygon className="hex" points={hexPoints({ x, y }, HEX_R - 2)} />
      <text className="t-id" x={x} y={y - 31}>
        #{tile.id}
      </text>
      {tile.commandToken && (
        <path d={`m${x + 9} ${y - 33} 9 0-4.5 8Z`} fill="var(--color-cyan)">
          <title>Your command token</title>
        </path>
      )}
      {tile.anomaly && (
        <g transform={`translate(${x} ${y - 10})`}>
          <AnomalyGlyph kind={tile.anomaly} />
        </g>
      )}
      {tile.planets.map((planet, index) => (
        <Planet
          key={planet.id}
          planet={planet}
          x={x + (tile.planets.length > 1 ? index * 24 - 12 : 0) - (tile.wormhole ? 8 : 0)}
          y={y - 10}
          view={view}
          task={task}
        />
      ))}
      {tile.wormhole && (
        <g
          className="wormhole"
          transform={`translate(${x + (tile.planets.length ? 14 : 0)} ${y - 10})`}
        >
          <circle r="7.5" />
          <text y="3">{tile.wormhole}</text>
        </g>
      )}
      {(tile.name === "Empty space" && !active ? [] : names).map((name, index) => (
        <text
          key={name}
          className={cx("t-name", keep && "keep")}
          x={x}
          y={y + 13 + index * 9.5}
          fontSize={name.length > 10 ? 7.5 : 9}
        >
          {name}
        </text>
      ))}
      {active && names.length === 1 && (
        <text className="t-name t-active keep" x={x} y={y + 22.5} fontSize="7">
          ACTIVE
        </text>
      )}
      {tile.fleets.map((fleet, index) => (
        <text
          key={fleet.seat}
          className="t-mark"
          x={x + (index - (tile.fleets.length - 1) / 2) * (strength ? 34 : 26)}
          y={y + 38}
          style={{ fill: seats[fleet.seat].color }}
        >
          {seats[fleet.seat].symbol}
          {fleet.ships}
          {strength ? `·${fleet.strength.toFixed(1)}` : ""}
        </text>
      ))}
      {tile.pickedUp > 0 && (
        <text className="t-pick" x={x - 24} y={y - 22}>
          +{tile.pickedUp}
        </text>
      )}
    </g>
  );
});

function Route({ route, tiles }: { route: RouteView; tiles: Record<SystemId, TileView> }) {
  const { linked } = useLink([`rt:${route.id}`]);
  return (
    <path
      className={cx("route", route.staged ? "staged" : "idle", linked && "linked")}
      d={routePath(route.path, tiles)}
      markerEnd="url(#route-end)"
    />
  );
}

/** The galaxy: every system, the wormhole pairs, and the routes of the ships in the open task. */
export function GalaxyMap({
  view,
  mapView,
  svgRef,
}: {
  view: BoardView;
  mapView: MapViewId;
  svgRef: RefObject<SVGSVGElement | null>;
}) {
  const byId = useMemo(
    () => Object.fromEntries(view.tiles.map((tile) => [tile.id, tile])),
    [view.tiles],
  );
  return (
    <svg ref={svgRef} role="group" aria-label="Galaxy board">
      <defs>
        <marker
          id="route-end"
          viewBox="0 0 8 8"
          refX="6"
          refY="4"
          markerWidth="5"
          markerHeight="5"
          orient="auto"
        >
          <path d="M1 1 7 4 1 7" fill="none" stroke="var(--color-cyan)" strokeWidth="1.5" />
        </marker>
      </defs>
      {view.tiles.map((tile) => (
        <Tile
          key={tile.id}
          tile={tile}
          active={tile.id === view.activeSystem}
          inspected={tile.id === view.inspected}
          targeting={view.targeting}
          view={mapView}
          task={view.planetTask}
        />
      ))}
      {view.wormholes.map((pair) => (
        <path key={pair.join()} className="wormhole-arc" d={routePath(pair, byId)}>
          <title>{byId[pair[0]].wormhole} wormholes: these systems are adjacent</title>
        </path>
      ))}
      {view.routes.map((route) => (
        <Route key={route.id} route={route} tiles={byId} />
      ))}
    </svg>
  );
}
