import { cx } from "./cx";

const PATHS = {
  check: '<path d="m5 12 4 4L19 6"/>',
  lock: '<rect x="6" y="10" width="12" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  alert: '<path d="m12 3 10 17H2L12 3Z"/><path d="M12 9v4m0 3v.1"/>',
  edit: '<path d="m15 4 5 5-10 10-6 1 1-6L15 4Z"/><path d="m12 7 5 5"/>',
  minus: '<path d="M6 12h12"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  undo: '<path d="M8 6 3 11l5 5"/><path d="M3 11h11a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m16 6 5 5-5 5"/><path d="M21 11H10a5 5 0 0 0 0 10h3"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  carrier: '<path d="M4 9h16v6H4zM7 6h10v3M7 15v3m5-3v3m5-3v3M2 12h2m16 0h2"/>',
  flagship: '<path d="m12 2 6 7 2 11H4L6 9l6-7Zm0 5v9m-4-3h8M9 20v2m6-2v2"/>',
  warsun: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M4 12h5m6 0h5"/>',
  dreadnought: '<path d="m12 2 5 6 2 12H5L7 8l5-6Zm0 4v10M7 11h10"/>',
  cruiser: '<path d="m12 3 7 15-7-3-7 3L12 3Zm0 5v7"/>',
  destroyer: '<path d="m12 4 7 15-7-4-7 4L12 4ZM8 12h8"/>',
  fighter: '<path d="m12 4 2 7 7 6-9-3-9 3 7-6 2-7Zm0 10v6"/>',
  infantry: '<circle cx="12" cy="5" r="2"/><path d="M12 8v7m-5-4 5-2 5 2m-5 4-4 6m4-6 4 6"/>',
  mech: '<rect x="8" y="4" width="8" height="7" rx="1"/><path d="M6 11h12v5H6zM9 16v4m6-4v4M4 12v4m16-4v4"/>',
  pds: '<path d="M5 20h14M8 20v-5h8v5M12 15V9m0 0 6-5"/>',
  dock: '<circle cx="12" cy="12" r="3"/><path d="M12 3v6m0 6v6M3 12h6m6 0h6"/>',
  token: '<path d="M12 4 21 19H3Z"/>',
  card: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6m-6 4h6"/>',
  planet: '<circle cx="12" cy="12" r="6"/><path d="M6 9c-6 1-5 7 6 5s13-8 6-6"/>',
} as const;

export type IconName = keyof typeof PATHS;
export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={cx("inline-block shrink-0 align-middle", className ?? "size-4")}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
