import type { PaymentView } from "../../model";
import { Button, Card, cx } from "../../ui";
import { useDispatch } from "../context";

/**
 * The total of a payment, in one line. The player chooses the planets on the board only.
 * Trade goods are not on the board, so they have one button here.
 */
export function PaymentList({ view }: { view: PaymentView }) {
  const dispatch = useDispatch();
  const unit = view.unit === "resource" ? "" : ` ${view.unit}`;
  const short = view.editable && view.paid < view.cost;
  const goods = view.goods;
  return (
    <Card className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2">
      <h3 className="text-base font-semibold">{view.title}</h3>
      <span className="min-w-0 flex-1 text-sm text-muted">
        {view.summary ||
          (view.editable
            ? goods?.checked
              ? ""
              : "Choose planets on the map"
            : "No payment needed")}
      </span>
      {goods && (
        <Button
          size="sm"
          tone="quiet"
          active={goods.checked}
          aria-pressed={goods.checked}
          onClick={() => dispatch({ type: "setPayment", source: goods.id, on: !goods.checked })}
        >
          {goods.checked ? "✓ " : "+ "}
          {goods.label}
        </Button>
      )}
      <span className={cx("text-xs tabular-nums", short ? "text-red" : "text-muted")}>
        Cost {view.cost}
        {unit} · Paying {view.paid}
        {view.paid > view.cost ? ` · ${view.paid - view.cost} wasted` : ""}
      </span>
    </Card>
  );
}
