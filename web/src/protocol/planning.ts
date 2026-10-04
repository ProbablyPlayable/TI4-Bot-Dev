import type {
  AttemptIdentity,
  PendingChoiceDto,
  PlanningEnvelope,
  PlanningPublication,
  PlanningStatusMsg,
} from "./types.ts";

export function attemptKey(identity: AttemptIdentity): string {
  return `${identity.checkpoint_id}:${identity.generation_id}:${identity.plan_revision}`;
}
export function sameAttempt(a: AttemptIdentity, b: AttemptIdentity): boolean {
  return a.checkpoint_id === b.checkpoint_id && a.generation_id === b.generation_id;
}
export function compareIdentity(a: AttemptIdentity, b: AttemptIdentity): number {
  return (
    a.checkpoint_id - b.checkpoint_id ||
    a.generation_id - b.generation_id ||
    a.plan_revision - b.plan_revision
  );
}
export interface PlanningState {
  availability: PlanningStatusMsg | null;
  envelope: PlanningEnvelope | null;
  publication: PlanningPublication | null;
  publicationIdentity: AttemptIdentity | null;
  current: boolean;
  busy: boolean;
  error: string | null;
  resetEpoch: number;
}
export const initialPlanningState: PlanningState = {
  availability: null,
  envelope: null,
  publication: null,
  publicationIdentity: null,
  current: false,
  busy: false,
  error: null,
  resetEpoch: 0,
};
export function planningChoice(state: PlanningState): PendingChoiceDto | null {
  const e = state.envelope;
  if (
    !state.current ||
    state.busy ||
    !!state.availability?.application ||
    !e?.awaiting_answer ||
    typeof e.update !== "object" ||
    !("SafeOffer" in e.update) ||
    !e.update.SafeOffer.choice
  )
    return null;
  const choice = e.update.SafeOffer.choice;
  return { ...choice, actor: choice.player, nonce: `planning:${attemptKey(e.identity)}` };
}
export function applyPlanningStatus(
  state: PlanningState,
  status: PlanningStatusMsg,
): PlanningState {
  if (state.availability && status.checkpoint_id < state.availability.checkpoint_id) return state;
  if (
    state.envelope &&
    status.identity &&
    compareIdentity(status.identity, state.envelope.identity) < 0
  )
    return state;
  const current =
    state.current &&
    status.available &&
    !!status.identity &&
    !!state.envelope &&
    compareIdentity(status.identity, state.envelope.identity) === 0;
  return { ...state, availability: status, current };
}
export function applyPlanningEnvelope(
  state: PlanningState,
  envelope: PlanningEnvelope,
): PlanningState {
  const identity = envelope.identity;
  if (
    state.envelope &&
    sameAttempt(identity, state.envelope.identity) &&
    (envelope.publication_id < state.envelope.publication_id ||
      (envelope.publication_id === state.envelope.publication_id && state.current))
  )
    return state;
  if (
    (state.envelope && compareIdentity(identity, state.envelope.identity) < 0) ||
    (state.availability && identity.checkpoint_id < state.availability.checkpoint_id) ||
    (state.availability?.identity && compareIdentity(identity, state.availability.identity) < 0)
  )
    return state;
  const update = envelope.update;
  const publication =
    typeof update === "object"
      ? "SafeOffer" in update
        ? update.SafeOffer
        : "SafeStep" in update
          ? update.SafeStep
          : "Stopped" in update
            ? update.Stopped.last_safe_publication
            : null
      : null;
  return {
    ...state,
    envelope,
    publication: publication ?? state.publication,
    publicationIdentity: publication ? identity : state.publicationIdentity,
    resetEpoch:
      state.resetEpoch +
      (state.envelope && (envelope.reset_revision ?? 0) !== (state.envelope.reset_revision ?? 0)
        ? 1
        : 0),
    current: update !== "Preparing",
    error: null,
  };
}
/** A retired answer was not recorded; explicit pipelines may retry their remaining intent. */
export class PlanningRefreshError extends Error {}
