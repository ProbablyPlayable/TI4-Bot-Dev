import type { RecordedDecisionDto } from "./types.ts";

export function movementShipKey(
  origin: string,
  unit: string,
  damaged: boolean,
  gravityDrive = false,
  ionian = false,
): string {
  return `${origin}:${unit}${damaged ? ":damaged" : ""}${gravityDrive ? ":gravity_drive" : ""}${ionian ? ":ionian" : ""}`;
}

export function movementCargoKey(
  origin: string,
  unit: string,
  source: string | null,
  damaged: boolean,
  galvanized = false,
): string {
  return `cargo:${origin}:${unit}:${source ?? "space"}${damaged ? ":damaged" : ""}${galvanized ? ":galvanized" : ""}`;
}

/** Restore editable quantities from the retained answers, never their old option indexes. */
export function recordedMovementStaging(decisions: RecordedDecisionDto[]): Record<string, number> {
  const staging: Record<string, number> = {};
  for (const decision of decisions) {
    const p = decision.payload;
    if (typeof p.unit !== "string") continue;
    let key: string;
    if (
      decision.context?.subtype === "movement_step" &&
      decision.kind === "move" &&
      typeof p.origin === "string"
    ) {
      key = movementShipKey(
        p.origin,
        p.unit,
        p.damaged === true,
        p.gravity_drive === true,
        p.ionian === true,
      );
    } else if (
      decision.context?.subtype === "load_cargo" &&
      decision.kind === "load" &&
      typeof p.system === "string"
    ) {
      key = movementCargoKey(
        typeof p.pickup_system === "string" ? p.pickup_system : p.system,
        p.unit,
        typeof p.source === "string" ? p.source : null,
        p.damaged === true,
        p.galvanized === true,
      );
    } else continue;
    staging[key] = (staging[key] ?? 0) + 1;
  }
  return staging;
}
