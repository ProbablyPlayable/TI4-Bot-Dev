import { createContext, useContext, type ReactNode } from "react";
import type { ActionButtonView, Intent, Rich, SeatId, SeatView } from "../model";
import { Button } from "../ui";

const SeatsContext = createContext<Record<SeatId, SeatView>>({});
const DispatchContext = createContext<(intent: Intent) => void>(() => {});

export function GameProvider({
  seats,
  dispatch,
  children,
}: {
  seats: Record<SeatId, SeatView>;
  dispatch: (intent: Intent) => void;
  children: ReactNode;
}) {
  return (
    <SeatsContext.Provider value={seats}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </SeatsContext.Provider>
  );
}

export const useSeats = () => useContext(SeatsContext);
export const useSeat = (id: SeatId) => useContext(SeatsContext)[id];
export const useDispatch = () => useContext(DispatchContext);

/** The shape and colour of a seat. Shape alone identifies it. */
export function SeatSymbol({ seat }: { seat: SeatId }) {
  const view = useSeat(seat);
  return <span style={{ color: view?.color }}>{view?.symbol}</span>;
}

/** Who controls something: seat symbol and faction, or nobody. */
export function OwnerLabel({ seat }: { seat: SeatId | null }) {
  const view = useSeats()[seat ?? ""];
  return (
    <span className="flex items-baseline gap-1.5 text-muted">
      {view ? (
        <SeatSymbol seat={view.id} />
      ) : (
        <i className="inline-block size-[7px] shrink-0 rounded-full bg-faint" />
      )}
      {view ? view.faction : "Nobody"}
    </span>
  );
}

export function RichText({ value }: { value: Rich }) {
  return (
    <>
      {value.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : "seat" in part ? (
          <SeatSymbol key={index} seat={part.seat} />
        ) : (
          <span key={index} className="text-accent">
            {part.accent}
          </span>
        ),
      )}
    </>
  );
}

/** A button that the data source offers. A click sends its intent. */
export function ActionButton({
  view,
  size,
  describedBy,
}: {
  view: ActionButtonView;
  size?: "md" | "sm";
  describedBy?: string;
}) {
  const dispatch = useDispatch();
  return (
    <Button
      tone={view.tone}
      size={size}
      disabled={view.disabled}
      aria-pressed={view.pressed}
      aria-describedby={describedBy}
      iconAfter={view.arrow ? "arrow" : undefined}
      onClick={() => dispatch(view.intent)}
    >
      {view.label}
    </Button>
  );
}
