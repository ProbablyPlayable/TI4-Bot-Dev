import type { HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  icon?: IconName;
  /** Replaces the icon, for example with an order number. */
  lead?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Shown under the subtitle, for example a route. */
  extra?: ReactNode;
  controls?: ReactNode;
  invalid?: boolean;
  linked?: boolean;
  compact?: boolean;
}

/** One thing in a list with its controls on the right: a unit line, an option, a player. */
export function ListRow({
  icon,
  lead,
  title,
  subtitle,
  extra,
  controls,
  invalid,
  linked,
  compact,
  className,
  ...rest
}: ListRowProps) {
  return (
    <div
      className={cx(
        "row flex items-center justify-between gap-3 px-3.5 [.row+&]:border-t [.row+&]:border-line/50 @max-[640px]:flex-wrap",
        compact ? "py-1" : "py-[7px]",
        invalid && "bg-red/[.027]",
        linked && "bg-cyan/[.06]",
        className,
      )}
      {...rest}
    >
      <div className="flex min-w-0 items-center gap-2.5 text-base">
        {lead ?? (icon && <Icon name={icon} className="size-[22px] text-icon" />)}
        <div className="min-w-0">
          <strong className={cx("font-mid", invalid && "text-red")}>{title}</strong>
          {subtitle != null && (
            <small
              className={cx(
                "text-xs",
                compact ? "ml-1.5 inline" : "block",
                invalid ? "text-red" : "text-muted",
              )}
            >
              {subtitle}
            </small>
          )}
          {extra}
        </div>
      </div>
      {controls != null && (
        <div className="flex shrink-0 items-center gap-2 @max-[640px]:ml-auto">{controls}</div>
      )}
    </div>
  );
}

export function Quantity({ count }: { count: number }) {
  return <span className="font-mid tabular-nums">× {count}</span>;
}

export interface CheckRowProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "title" | "type"
> {
  title: ReactNode;
  aside?: ReactNode;
  linked?: boolean;
  rowProps?: HTMLAttributes<HTMLLabelElement>;
}

/** A whole-row checkbox: a payment source, a card to exhaust. */
export function CheckRow({ title, aside, linked, rowProps, ...input }: CheckRowProps) {
  return (
    <label
      {...rowProps}
      className={cx(
        "check flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-sm [.check+&]:border-t [.check+&]:border-line",
        linked && "bg-cyan/[.06]",
      )}
    >
      <input type="checkbox" className="m-0 size-[15px] accent-(--accent)" {...input} />
      <strong className="font-mid">{title}</strong>
      {aside != null && <span className="ml-auto text-xs text-muted">{aside}</span>}
    </label>
  );
}
