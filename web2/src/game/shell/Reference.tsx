import { useState } from "react";
import type { ListSectionView, PlayerRowView, ReferenceView } from "../../model";
import { Button, Drawer, Eyebrow, cx } from "../../ui";
import { RichText, SeatSymbol, useDispatch, useSeat, useSeats } from "../context";

function Sections({ sections }: { sections: ListSectionView[] }) {
  return (
    <>
      {sections.map((section) => (
        <div key={section.title}>
          <h3 className="mt-3.5 text-muted">
            <Eyebrow>{section.title}</Eyebrow>
          </h3>
          <ul className="mt-1 list-disc pl-[18px]">
            {section.rows.map((row, index) => (
              <li key={index} className="mt-[3px]">
                <RichText value={row} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function Log({ log }: { log: ReferenceView["log"] }) {
  const dispatch = useDispatch();
  const seats = useSeats();
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      log.filter((round) => round.current).map((round) => ["r" + round.round, true]),
    ),
  );
  const toggle = (id: string) => setOpen((now) => ({ ...now, [id]: !now[id] }));
  return (
    <>
      {log.map((round) => (
        <div key={round.round}>
          <button
            type="button"
            className="mt-3 block w-full border-b border-line py-1.5 text-left font-strong"
            aria-expanded={!!open["r" + round.round]}
            onClick={() => toggle("r" + round.round)}
          >
            {open["r" + round.round] ? "▾" : "▸"} {round.label}
          </button>
          {open["r" + round.round] &&
            round.entries.map((entry) => (
              <div
                key={entry.id}
                className={cx(
                  "border-b border-line/50 py-2",
                  entry.current && "border-l-2 border-l-cyan pl-2",
                )}
              >
                <div className="flex flex-col gap-px">
                  <span>
                    <SeatSymbol seat={entry.seat} /> <strong>{seats[entry.seat].name}</strong> ·{" "}
                    {entry.type}
                  </span>
                  <span className="text-muted">{entry.summary}</span>
                </div>
                <div className="mt-[5px] flex gap-1.5">
                  {entry.current ? (
                    <span className="text-muted">Shown in Live</span>
                  ) : (
                    <>
                      <Button
                        tone="quiet"
                        size="sm"
                        aria-expanded={!!open[entry.id]}
                        onClick={() => toggle(entry.id)}
                      >
                        Steps
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => dispatch({ type: "inspectLogEntry", id: entry.id })}
                      >
                        Inspect
                      </Button>
                    </>
                  )}
                </div>
                {open[entry.id] && (
                  <ol className="mt-1 list-decimal pl-[18px]">
                    {entry.stages.map((stage) => (
                      <li key={stage.name} className="mt-[3px]">
                        <strong>{stage.name}</strong> · {stage.text}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            ))}
        </div>
      ))}
    </>
  );
}

/** The cards that are played in a reaction window. The setting belongs to the card. */
function OfferCards({ cards }: { cards: ReferenceView["offerCards"] }) {
  const dispatch = useDispatch();
  if (!cards.length) {
    return null;
  }
  return (
    <div>
      <h3 className="mt-3.5 text-muted">
        <Eyebrow>Reaction cards · offer</Eyebrow>
      </h3>
      {cards.map((item) => (
        <div key={item.card} className="mt-2 flex items-start justify-between gap-3">
          <span>
            <strong>{item.card}</strong>
            <span className="block text-xs text-muted">{item.text}</span>
          </span>
          <Button
            size="sm"
            tone="quiet"
            active={item.never}
            aria-pressed={item.never}
            aria-label={`Never offer ${item.card}`}
            onClick={() => dispatch({ type: "setCardOffer", card: item.card, never: !item.never })}
          >
            {item.never ? "Never offered" : "Offered"}
          </Button>
        </div>
      ))}
    </div>
  );
}

function playerSections(row: PlayerRowView): ListSectionView[] {
  return [
    { title: "Faction abilities", rows: row.abilities.map((text) => [text]) },
    { title: "Technologies", rows: row.technologies.map((text) => [text]) },
    { title: "Leaders", rows: [[row.leaders]] },
    {
      title: "Economy",
      rows: [
        [`Resources ${row.resources.join(" / ")} · Influence ${row.influence.join(" / ")}`],
        [`Trade goods ${row.tradeGoods} · Commodities ${row.commodities.join(" / ")}`],
        [`Command tokens ${row.tokens.join(" · ")} (tactic · fleet · strategy)`],
        [
          `${row.actionCards} action cards · ${row.secrets[1]} secret objectives, ${row.secrets[0]} scored`,
        ],
      ],
    },
  ];
}

const TITLES = {
  objectives: "Objectives",
  technology: "Technology",
  cards: "Cards",
  log: "Log",
} as const;

/** Reference sheets that open over the board: objectives, technology, cards, the log, a player sheet. */
export function ReferenceDrawer({
  id,
  view,
  players,
  onClose,
}: {
  id: string;
  view: ReferenceView;
  players: PlayerRowView[];
  onClose: () => void;
}) {
  const player = id.startsWith("player:")
    ? players.find((row) => row.seat === id.slice(7))
    : undefined;
  const seat = useSeat(player?.seat ?? "");
  if (player) {
    return (
      <Drawer title={`${seat.name} · ${seat.faction}`} onClose={onClose}>
        <Sections sections={playerSections(player)} />
      </Drawer>
    );
  }
  const key = id as keyof typeof TITLES;
  return (
    <Drawer title={TITLES[key]} onClose={onClose}>
      {key === "log" ? <Log log={view.log} /> : <Sections sections={view[key]} />}
      {key === "cards" && <OfferCards cards={view.offerCards} />}
    </Drawer>
  );
}
