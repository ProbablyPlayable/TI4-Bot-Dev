import type { PaymentChoiceView, PaymentView } from "../../model";
import { Card, CardHeading, CardText, CheckRow } from "../../ui";
import { useDispatch } from "../context";
import { useLink } from "../link";

function Choice({ choice }: { choice: PaymentChoiceView }) {
  const dispatch = useDispatch();
  const { linked, props } = useLink(
    choice.system ? [`pl:${choice.id}`, `sys:${choice.system}`] : undefined,
  );
  return (
    <CheckRow
      checked={choice.checked}
      onChange={(event) =>
        dispatch({ type: "setPayment", source: choice.id, on: event.target.checked })
      }
      linked={linked}
      rowProps={props}
      aside={choice.aside}
      title={
        <>
          {choice.label}
          {choice.system && <span className="font-normal text-muted"> #{choice.system}</span>}
        </>
      }
    />
  );
}

/** What pays for a cost: planets to exhaust and trade goods. The same planets can be chosen on the board. */
export function PaymentList({ view }: { view: PaymentView }) {
  const unit = view.unit === "resource" ? "" : ` ${view.unit}`;
  return (
    <Card>
      <CardHeading title={view.title} bad={view.choices !== null && view.paid < view.cost}>
        <span className="tabular-nums">
          Cost {view.cost}
          {unit} · Paying {view.paid}
          {view.paid > view.cost ? ` · ${view.paid - view.cost} wasted` : ""}
        </span>
      </CardHeading>
      {view.choices ? (
        view.choices.map((choice) => <Choice key={choice.id} choice={choice} />)
      ) : (
        <CardText>{view.summary}</CardText>
      )}
    </Card>
  );
}
