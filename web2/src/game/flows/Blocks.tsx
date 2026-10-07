import type { BlockView, RowView } from "../../model";
import { Badge, Card, CardHeading, Counter, Hint, InlineNote, ListRow, cx } from "../../ui";
import { ActionButton, RichText, useDispatch } from "../context";
import { useLink } from "../link";
import { PaymentList } from "../steps/PaymentList";

function Row({ row }: { row: RowView }) {
  const dispatch = useDispatch();
  const { linked, props } = useLink(row.link);
  const control = row.control;
  return (
    <ListRow
      icon={row.icon}
      lead={
        row.order !== undefined ? (
          <span className="grid size-[22px] place-items-center rounded-full border border-line text-xs text-muted tabular-nums">
            {row.order}
          </span>
        ) : undefined
      }
      title={
        <span className="inline-flex items-center gap-2">
          <span>
            <RichText value={row.title} />
          </span>
          {row.hint && <Hint label="Rules">{row.hint}</Hint>}
        </span>
      }
      subtitle={row.subtitle}
      linked={linked}
      {...props}
      controls={
        control &&
        (control.kind === "button" ? (
          <ActionButton view={control.button} />
        ) : control.kind === "counter" ? (
          <Counter
            {...control.counter}
            onChange={(value) => dispatch({ type: "flowCount", key: control.counter.id, value })}
          />
        ) : (
          <Badge tone={control.pill.tone}>{control.pill.label}</Badge>
        ))
      }
    />
  );
}

/**
 * Content for actions that have no dedicated view yet: strategy cards and component actions.
 * The data source sends blocks; this renders them with the shared primitives.
 */
export function Blocks({ blocks }: { blocks: BlockView[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "note":
            return (
              <InlineNote key={index} tone={block.tone} strong={block.strong}>
                {block.text}
              </InlineNote>
            );
          case "card":
            return (
              <Card key={index}>
                <CardHeading title={block.title} bad={block.bad}>
                  {block.aside}
                </CardHeading>
                {block.rows.every((row) => row.order !== undefined) ? (
                  // A list in seat order: two columns, read down the left column first.
                  <div
                    className="grid grid-flow-col grid-cols-2 [&>.row]:border-t-0"
                    style={{
                      gridTemplateRows: `repeat(${Math.ceil(block.rows.length / 2)}, auto)`,
                    }}
                  >
                    {block.rows.map((row, at) => (
                      <Row key={at} row={row} />
                    ))}
                  </div>
                ) : (
                  block.rows.map((row, at) => <Row key={at} row={row} />)
                )}
              </Card>
            );
          case "payment":
            return <PaymentList key={index} view={block.payment} />;
          case "draft":
            // A choice that is prepared before the player's seat is reached. Dashed while it is private.
            return (
              <div
                key={index}
                className={cx(
                  "rounded-lg border",
                  block.live
                    ? "border-cyan/50 bg-cyan/[.024]"
                    : "border-dashed border-gold/50 bg-gold/[.024]",
                )}
              >
                <CardHeading title={block.title}>
                  <span className="inline-flex items-center gap-2">
                    <Badge tone={block.pill.tone}>{block.pill.label}</Badge>
                    {block.hint && <Hint label={`About ${block.title}`}>{block.hint}</Hint>}
                  </span>
                </CardHeading>
                {block.text && <div className="px-3.5 py-2 text-xs">{block.text}</div>}
                {block.blocks.length > 0 && (
                  <div className="space-y-2.5 p-2.5">
                    <Blocks blocks={block.blocks} />
                  </div>
                )}
              </div>
            );
        }
      })}
    </>
  );
}
