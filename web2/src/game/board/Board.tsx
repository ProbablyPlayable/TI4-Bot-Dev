import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { BoardView, InspectorView } from "../../model";
import { forceText } from "../../model";
import { Button, CloseButton, Segmented } from "../../ui";
import { OwnerLabel, useDispatch } from "../context";
import { GalaxyMap, type MapViewId } from "./GalaxyMap";
import { useCamera } from "./useCamera";

const MAP_VIEWS: { id: MapViewId; label: string; legend: string }[] = [
  { id: "standard", label: "Standard", legend: "symbol + number: ships of that player" },
  { id: "economy", label: "Res / Inf", legend: "resources / influence per planet" },
  { id: "space", label: "Space combat", legend: "ships · average hits per round" },
  { id: "ground", label: "Ground combat", legend: "ground forces per planet · ◈ Planetary Shield" },
  { id: "tech", label: "Tech skips", legend: "B G Y R technology specialty" },
];

/** What is in one system: fleets, planets, and what the open action plans there. */
function SystemInspector({ view }: { view: InspectorView }) {
  const dispatch = useDispatch();
  return (
    <div className="absolute bottom-2.5 left-2.5 z-2 max-h-[40%] w-[280px] overflow-auto rounded border border-line bg-surface/95 px-3 py-2.5 text-xs">
      <CloseButton
        label="Close system details"
        className="float-right -mt-1 -mr-1.5 ml-1.5"
        onClick={() => dispatch({ type: "closeInspector" })}
      />
      <h3 className="text-base font-semibold">{view.title}</h3>
      <div className="text-muted">{view.facts}</div>
      {view.notes.map((note) => (
        <div key={note} className="text-muted">
          {note}
        </div>
      ))}
      {view.rows.map((row, index) => (
        <div
          key={index}
          className="mt-[7px] grid grid-cols-[78px_minmax(0,1fr)] gap-2 border-t border-line pt-[7px]"
        >
          <span>
            {row.seat ? (
              <OwnerLabel seat={row.seat} />
            ) : row.planet ? (
              <>
                {row.planet.name}
                <div className="text-muted">
                  {row.planet.resources} / {row.planet.influence}
                </div>
              </>
            ) : (
              row.label
            )}
          </span>
          <span>
            {row.planet && <OwnerLabel seat={row.planet.owner} />}
            {row.text}
            {row.force && forceText(row.force)}
            {row.notes?.map((note) => (
              <div
                key={note.text}
                className={note.tone === "planned" ? "text-accent" : "text-muted"}
              >
                {note.text}
              </div>
            ))}
          </span>
        </div>
      ))}
      {view.activate && (
        <div className="mt-2 border-t border-line pt-2">
          {view.activate === "token" ? (
            <span className="text-muted">
              Your command token is here. You cannot activate this system again.
            </span>
          ) : (
            <Button
              size="sm"
              iconAfter="arrow"
              onClick={() =>
                dispatch({ type: "pickAction", action: "tactical", system: view.system })
              }
            >
              Activate this system
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The board fills the left of the shell. Everything else on it floats: views, tools, inspector, latest result. */
export function Board({
  view,
  logOpen,
  onLog,
  children,
}: {
  view: BoardView;
  logOpen: boolean;
  onLog: () => void;
  children?: ReactNode;
}) {
  const [mapView, setMapView] = useState<MapViewId>("standard");
  const svg = useRef<SVGSVGElement>(null);
  const galaxy = useRef<HTMLDivElement>(null);
  const camera = useCamera(svg, galaxy, view.tiles);
  useLayoutEffect(() => camera.fitFor(view.taskSystems), [view.fitKey]);
  const tool = "h-7 rounded-sm border border-line bg-surface text-base";
  return (
    <section
      aria-label="Galaxy board"
      className="relative flex min-h-0 min-w-0 overflow-hidden bg-board"
    >
      <div className="pointer-events-none absolute top-2 right-[210px] left-2.5 z-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Segmented
          label="Map view"
          options={MAP_VIEWS}
          value={mapView}
          onChange={setMapView}
          className="pointer-events-auto bg-surface"
        />
      </div>
      {!view.inspector && (
        <span className="absolute bottom-3 left-3 z-2 flex max-w-[42%] flex-wrap gap-x-3 gap-y-0.5 text-xs text-faint">
          <span>{MAP_VIEWS.find((item) => item.id === mapView)!.legend}</span>
          <span>▼ your command token</span>
          <span>α β wormholes</span>
          <span>inner ring: ships of one player · red dashed: contested</span>
        </span>
      )}
      <div aria-label="Map zoom" className="absolute top-2 right-2.5 z-2 flex gap-[3px]">
        <button
          type="button"
          className={`${tool} w-7`}
          aria-label="Zoom out"
          onClick={() => camera.zoom(0.8)}
        >
          −
        </button>
        <button
          type="button"
          className={`${tool} w-7`}
          aria-label="Zoom in"
          onClick={() => camera.zoom(1.25)}
        >
          +
        </button>
        <button
          type="button"
          className={`${tool} px-2 text-xs! whitespace-nowrap`}
          title="Show the systems of this action"
          onClick={() => camera.fit(view.taskSystems)}
        >
          Fit task
        </button>
        <button
          type="button"
          className={`${tool} px-2 text-xs! whitespace-nowrap`}
          title="Show the full board"
          onClick={() => camera.fit()}
        >
          Fit board
        </button>
      </div>
      <div
        ref={galaxy}
        className="galaxy relative min-h-0 min-w-0 flex-1"
        onClickCapture={(event) => {
          if (!camera.wasDrag()) return;
          event.stopPropagation();
          event.preventDefault();
        }}
      >
        <GalaxyMap view={view} mapView={mapView} svgRef={svg} />
      </div>
      {view.inspector && <SystemInspector view={view.inspector} />}
      <div className="absolute right-2.5 bottom-2.5 z-2 flex max-w-[calc(100%-310px)] items-center gap-2.5 rounded border border-line bg-surface/95 py-1 pr-1.5 pl-3 text-xs text-muted">
        <span>{view.latestResult}</span>
        <Button tone="quiet" size="sm" aria-expanded={logOpen} onClick={onLog}>
          Log
        </Button>
      </div>
      {children}
    </section>
  );
}
