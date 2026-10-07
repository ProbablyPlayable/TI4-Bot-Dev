import type { MoveRowView, MovementView, OriginView } from "../../model";
import { plural, unitName } from "../../model";
import {
  Button,
  Card,
  CardHeading,
  Counter,
  Die,
  Gauge,
  Gauges,
  Icon,
  InlineNote,
  ListRow,
  Pill,
  Quantity,
  SectionTitle,
  cx,
} from "../../ui";
import { BattleTable } from "../combat/BattleTable";
import { RichText, useDispatch } from "../context";
import { useLink } from "../link";

function MoveRow({ row }: { row: MoveRowView }) {
  const dispatch = useDispatch();
  const { linked, props } = useLink(row.link);
  const route = row.route;
  return (
    <ListRow
      icon={row.unit}
      title={row.name}
      subtitle={<RichText value={row.subtitle} />}
      invalid={row.invalid}
      linked={linked}
      {...props}
      extra={
        route && (
          <div className="mt-[3px] flex flex-wrap items-center gap-1.5 text-xs text-muted">
            {route.options.length ? (
              <select
                className="max-w-full rounded-[5px] border border-line bg-canvas px-1.5 py-0.5 text-text"
                aria-label={`Route for ${row.name}`}
                value={route.selected}
                onChange={(event) =>
                  dispatch({
                    type: "chooseRoute",
                    line: route.line,
                    index: Number(event.target.value),
                  })
                }
              >
                {route.options.map((option) => (
                  <option key={option.index} value={option.index}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <span>{route.text}</span>
            )}
            {route.riftRoll && (
              <Pill
                tone="loss"
                title="One die for each rift the ship leaves. The ship and its cargo are destroyed on 1–3."
              >
                Rift roll · destroyed on 1–3
              </Pill>
            )}
          </div>
        )
      }
      controls={
        row.counter ? (
          <>
            {row.removable && (
              <Button size="sm" onClick={() => dispatch({ type: "removeLine", key: row.key })}>
                Remove from fleet
              </Button>
            )}
            <Counter
              {...row.counter}
              onChange={(value) => dispatch({ type: "setCount", key: row.key, value })}
            />
          </>
        ) : (
          row.quantity !== null && <Quantity count={row.quantity} />
        )
      }
    />
  );
}

function SubHeading({ system, children }: { system?: string; children: React.ReactNode }) {
  const { linked, props } = useLink(system ? [`sys:${system}`] : undefined);
  return (
    <div
      className={cx(
        "border-t border-line px-3.5 pt-[7px] pb-1 text-xs text-muted",
        !system && "font-bold tracking-[.06em] uppercase",
        linked && "bg-cyan/[.06]",
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/** The ships and cargo that can leave one system. */
function Origin({ origin }: { origin: OriginView }) {
  const dispatch = useDispatch();
  const { linked, props } = useLink([`sys:${origin.system}`]);
  if (origin.collapsed)
    return (
      <button
        type="button"
        aria-expanded={false}
        onClick={() => dispatch({ type: "expandOrigin", system: origin.system })}
        className={cx(
          "flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 rounded-lg border border-line px-3.5 py-[9px] text-left text-sm text-muted",
          linked && "bg-cyan/[.06]",
        )}
        {...props}
      >
        <strong className="font-semibold text-text">{origin.label}</strong>
        <span>
          {plural(origin.collapsed.away, "system")} away · {origin.collapsed.names} can reach
        </span>
        <span className="ml-auto text-accent">Show</span>
      </button>
    );
  return (
    <Card {...props}>
      <CardHeading title={origin.label} bad={origin.cargo > origin.capacity}>
        {origin.away !== null ? `${plural(origin.away, "system")} away · ` : ""}Capacity{" "}
        {origin.cargo} / {origin.capacity}
        {origin.carriers.length > 1 ? ` · ${origin.carriers.join(", ")}` : ""}
      </CardHeading>
      {origin.rows.map((row) => (
        <MoveRow key={row.key} row={row} />
      ))}
      {origin.pickups.length > 0 && <SubHeading>Pick up on the way</SubHeading>}
      {origin.pickups.map((site) => (
        <div key={site.system}>
          <SubHeading system={site.system}>
            <strong className="font-semibold text-text">{site.label}</strong>
            {site.commandToken ? " · Command token here · cannot pick up" : ""}
          </SubHeading>
          {site.rows.map((row) => (
            <MoveRow key={row.key} row={row} />
          ))}
        </div>
      ))}
      {origin.stays.length > 0 && (
        <div className="border-t border-line px-3.5 py-[7px] text-xs text-faint">
          Stays behind: {origin.stays.join("; ")}
        </div>
      )}
    </Card>
  );
}

function Unreachable({ row }: { row: NonNullable<MovementView["unreachable"]>["rows"][number] }) {
  const { linked, props } = useLink([`sys:${row.system}`]);
  return (
    <ListRow icon={row.unit} title={row.name} subtitle={row.text} linked={linked} {...props} />
  );
}

/** Step 2: stage ships by origin, load cargo, choose routes. Anomalies and wormholes show in the routes. */
export function MovementStep({ view }: { view: MovementView }) {
  return (
    <>
      {view.origins.length ? (
        view.origins.map((origin) => <Origin key={origin.system} origin={origin} />)
      ) : (
        <InlineNote tone="quiet">
          No ships are staged. You may activate a system without moving.
        </InlineNote>
      )}
      {view.unreachable && (
        <Card>
          <CardHeading title={`Cannot reach #${view.unreachable.target}`}>
            {plural(view.unreachable.rows.length, "ship")}
          </CardHeading>
          {view.unreachable.rows.map((row, index) => (
            <Unreachable key={index} row={row} />
          ))}
        </Card>
      )}
      <Gauges>
        {view.gauges.map((gauge) => (
          <Gauge key={gauge.label} {...gauge} />
        ))}
      </Gauges>
      {view.excessShips > 0 && (
        <InlineNote
          strong={
            <>
              <Icon name="alert" /> Over fleet supply.
            </>
          }
        >
          {plural(view.excessShips, "excess ship")} will be removed after movement.
        </InlineNote>
      )}
      {view.riftRolls > 0 && (
        <InlineNote
          strong={
            <>
              <Icon name="alert" /> {plural(view.riftRolls, "rift roll")}.
            </>
          }
        >
          Each ship that leaves a gravity rift is destroyed on 1–3, with its cargo.
        </InlineNote>
      )}
      {view.rift && (
        <>
          <SectionTitle>Gravity rift</SectionTitle>
          <Card>
            {view.rift.map((ship, index) => (
              <ListRow
                key={index}
                icon={ship.unit}
                title={ship.name}
                subtitle={ship.text}
                invalid={!!ship.roll?.lost}
                controls={
                  ship.roll ? (
                    <>
                      <Die roll={ship.roll.face} hit={!ship.roll.lost} />
                      <Pill tone={ship.roll.lost ? "loss" : "staged"}>
                        {ship.roll.lost ? "Destroyed" : "Survives"}
                      </Pill>
                    </>
                  ) : (
                    <>
                      <Die />
                      <Pill tone="staged">Survives on 4+ · 70%</Pill>
                    </>
                  )
                }
              />
            ))}
          </Card>
        </>
      )}
      {view.removed.length > 0 && (
        <InlineNote>
          Removed after movement: {view.removed.map((unit) => unitName(unit)).join(", ")}.
        </InlineNote>
      )}
      {view.cannon && (
        <>
          <SectionTitle>Space cannon offense</SectionTitle>
          <BattleTable view={view.cannon} />
        </>
      )}
      {view.cannonSkipped && (
        <InlineNote tone="quiet" strong="Space cannon offense skipped.">
          No enemy PDS can reach the active system.
        </InlineNote>
      )}
    </>
  );
}
