import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export type BadgeTone = "draft" | "live" | "done" | "alert" | "quiet";

const BADGE: Record<BadgeTone, string> = {
  draft: "text-gold bg-gold/[.07] border-gold/20",
  live: "text-cyan bg-cyan/[.07] border-cyan/20",
  done: "text-green bg-green/[.07] border-green/20",
  alert: "text-red bg-red/[.07] border-red/20",
  quiet: "text-muted border-line",
};

export function Badge({
  tone,
  children,
  className,
}: {
  tone: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-[5px] rounded-sm border px-[7px] py-0.5 text-xs font-bold whitespace-nowrap",
        BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export type PillTone = "plain" | "loss" | "damage" | "staged";

const PILL: Record<PillTone, string> = {
  plain: "text-muted border-line",
  loss: "text-red border-red/25 bg-red/5",
  damage: "text-gold border-gold/25",
  staged: "text-muted border-line border-dashed",
};

export function Pill({
  tone = "plain",
  children,
  title,
}: {
  tone?: PillTone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cx("rounded-sm border px-1.5 text-xs font-strong whitespace-nowrap", PILL[tone])}
    >
      {children}
    </span>
  );
}

export function Eyebrow({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cx("text-xs font-bold tracking-[.08em] uppercase", className)} {...rest} />
  );
}
