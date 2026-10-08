import type { PlanningState } from "../protocol/planning.ts";
import type { PlanningStopReason, SecondaryDraftStatus } from "../protocol/types.ts";
import { findStrategyCardMeta, humanizeId } from "../protocol/contentCatalog.ts";

export interface SecondaryDraftView {
  cardName: string;
  initiative: number | null;
  /** The seat that played the card (a raw seat id; resolve it with the player identity). */
  playedBy: string;
  /** Where the live game is: the primary, or this seat's place in the follower window. */
  stage: string;
  /** Where the draft is. */
  state: string;
  hint: string;
  ready: boolean;
  canReady: boolean;
  canReset: boolean;
  /** The server is answering, or has answered, the live window from this draft. */
  submitting: boolean;
}

const stopped: Record<PlanningStopReason, string> = {
  SecondaryComplete: "Draft complete",
  ReplayMismatch: "No longer fits the game",
  Uncertainty: "Recorded up to an unknown outcome",
  KnowledgeChanged: "Recorded up to an unknown outcome",
  OtherPlayerRequired: "Recorded up to a live decision",
  UnsupportedOffer: "Recorded up to a live decision",
  UnsupportedParticipation: "Recorded up to a live decision",
  UnsupportedSegment: "Recorded up to a live decision",
  StepLimit: "Recorded up to a live decision",
  MovementComplete: "Draft complete",
};

/** A follower's secondary draft as the strip shows it. */
export function describeSecondaryDraft(
  status: SecondaryDraftStatus,
  planning: PlanningState,
): SecondaryDraftView {
  const meta = findStrategyCardMeta(status.card);
  const envelope = planning.envelope;
  const update = envelope?.update;
  const reason = typeof update === "object" && "Stopped" in update ? update.Stopped.reason : null;
  const failed = typeof update === "object" && "Failed" in update;
  const recorded = envelope?.progress.recorded_answers ?? 0;
  const application = status.application;
  // The preview closed without a question: this seat cannot follow the card as things stand.
  const nothingToDecide = reason === "SecondaryComplete" && recorded === 0;
  const stage = !status.window_open
    ? "Primary still resolving"
    : status.seats_before
      ? `Window open · ${status.seats_before} ${status.seats_before === 1 ? "seat" : "seats"} before you`
      : "Window open · you are next";
  const state = application
    ? {
        applying: "Submitting your draft",
        waiting_for_player: "Waiting for another player",
        needs_decision: "Needs your decision in Live",
        applied: "Submitted",
      }[application.state]
    : !status.has_draft
      ? "Not drafted"
      : !planning.current || !envelope
        ? "Preparing"
        : failed
          ? "Preview failed"
          : nothingToDecide
            ? "Nothing to decide"
            : reason
              ? stopped[reason]
            : envelope.awaiting_answer
              ? "Your choice"
              : "Replaying";
  const usable =
    status.has_draft &&
    planning.current &&
    !planning.busy &&
    !application &&
    !failed &&
    reason !== "ReplayMismatch";
  const hint = application
    ? application.message
    : status.ready
      ? "Your draft is submitted for you when the live window reaches your seat. Anything it does not cover is asked in Live."
      : !status.has_draft
        ? "Decide now instead of waiting for your turn in the window. Nothing is submitted until you mark the draft ready."
        : nothingToDecide
          ? "You cannot follow this card as things stand, so the live window will pass your seat. This is checked again when the primary resolves."
          : reason === "ReplayMismatch"
            ? "The game changed under this draft. Reset it and choose again."
          : recorded
            ? "Mark the draft ready to have it submitted when the live window reaches your seat."
            : "Choose in the draft below. Nothing is submitted until you mark it ready.";
  return {
    cardName: meta?.name ?? humanizeId(status.card),
    initiative: meta?.initiative ?? null,
    playedBy: status.played_by,
    stage,
    state,
    hint,
    ready: status.ready,
    canReady: usable && recorded > 0,
    canReset: usable && recorded > 0,
    submitting: !!application,
  };
}
