import { describe, expect, it } from "vitest";
import {
  applyPlanningEnvelope,
  applyPlanningStatus,
  applySecondaryStatus,
  initialPlanningState,
  planningChoice,
} from "./planning.ts";
import { decodeServerMessage } from "./decode.ts";
import type {
  PlanningEnvelope,
  PlanningStatusMsg,
  PlanningPublication,
  SecondaryDraftStatus,
} from "./types.ts";

const publication: PlanningPublication = {
  position: {
    round: 1,
    phase: "action",
    speaker: "b",
    seating_order: ["a", "b"],
    players: [],
    finished: false,
    board: { systems: {} },
    table: {
      revealed_objectives: [],
      scored_objectives: {},
      unclaimed_strategy_cards: [],
      strategy_card_goods: {},
      laws: {},
    },
  },
  choice: {
    player: "b",
    prompt: "movement",
    context: { subtype: "movement_step" },
    options: [{ id: "done_moving", kind: "decline", label: "Finish" }],
  },
  events: [],
};
const offer: PlanningEnvelope = {
  publication_id: 1,
  identity: { checkpoint_id: 10, generation_id: 2, plan_revision: 3 },
  awaiting_answer: true,
  recorded_request_ids: [],
  assumptions: ["Hypothetical"],
  progress: {
    recorded_answers: 2,
    replayed: 2,
    remaining: 0,
    completed_steps: 1,
    nested_answers_since_checkpoint: 0,
  },
  update: { SafeOffer: publication },
};
const status: PlanningStatusMsg = {
  type: "planning_status",
  protocol_version: 3,
  game_id: "game",
  checkpoint_id: 10,
  available: true,
  can_start: true,
  has_draft: true,
  identity: offer.identity,
};

describe("planning publications", () => {
  it("uses full offer identity and never exposes replay or stopped choices as actionable", () => {
    let state = applyPlanningEnvelope(initialPlanningState, offer);
    expect(planningChoice(state)?.nonce).toBe("planning:10:2:3");
    state = applyPlanningEnvelope(state, { ...offer, publication_id: 2, awaiting_answer: false });
    expect(planningChoice(state)).toBeNull();
    state = applyPlanningEnvelope(state, {
      ...offer,
      publication_id: 3,
      update: { Stopped: { reason: "Uncertainty", last_safe_publication: publication } },
    });
    expect(state.publication).toBe(publication);
    expect(planningChoice(state)).toBeNull();
    expect(applyPlanningEnvelope(state, offer)).toBe(state);
  });
  it("keeps an applied or interrupted script inspectable without exposing editable draft offers", () => {
    const old = applyPlanningEnvelope(initialPlanningState, offer);
    for (const applicationState of [
      "applying",
      "waiting_for_player",
      "needs_decision",
      "applied",
    ] as const) {
      const next = applyPlanningStatus(old, {
        ...status,
        can_apply: false,
        application: {
          applied: 2,
          total: 3,
          state: applicationState,
          message: "Live execution progress.",
        },
      });
      expect(next.publication).toBe(publication);
      expect(planningChoice(next)).toBeNull();
    }
    expect(() =>
      decodeServerMessage(
        {
          ...status,
          application: {
            applied: 4,
            total: 3,
            state: "applied",
            message: "Invalid progress.",
          },
        },
        "game",
      ),
    ).toThrow(/planning status/);
  });
  it("disables a retired preview before a replacement arrives and retains its inspectable position", () => {
    const old = applyPlanningStatus(applyPlanningEnvelope(initialPlanningState, offer), status);
    const next = applyPlanningStatus(old, {
      ...status,
      checkpoint_id: 11,
      identity: { ...offer.identity, checkpoint_id: 11, generation_id: 3 },
    });
    expect(next.current).toBe(false);
    expect(next.publication).toBe(publication);
    expect(planningChoice(next)).toBeNull();
    expect(applyPlanningEnvelope(next, offer)).toBe(next);
  });
  it("handles phase retirement without a replacement and disables controls after reconnect", () => {
    const old = applyPlanningEnvelope(initialPlanningState, offer);
    const unavailable = applyPlanningStatus(old, {
      ...status,
      checkpoint_id: 11,
      available: false,
      can_start: false,
      identity: null,
    });
    expect(unavailable.publication).toBe(publication);
    expect(planningChoice(unavailable)).toBeNull();
    expect(planningChoice({ ...old, current: false, availability: null })).toBeNull();
  });
  it("disables an old offer when the server advances its revision before publishing its next choice", () => {
    const state = applyPlanningStatus(applyPlanningEnvelope(initialPlanningState, offer), status);
    const next = applyPlanningStatus(state, {
      ...status,
      identity: { ...offer.identity, plan_revision: 4 },
    });
    expect(planningChoice(next)).toBeNull();
  });
  it("orders reconstructed checkpoints before generations and ignores old revisions", () => {
    const old = applyPlanningEnvelope(initialPlanningState, offer);
    const restored = {
      ...offer,
      identity: { checkpoint_id: 11, generation_id: 1, plan_revision: 0 },
    };
    const current = applyPlanningEnvelope(old, restored);
    expect(current.envelope).toBe(restored);
    expect(applyPlanningEnvelope(current, offer)).toBe(current);
    const newer = applyPlanningEnvelope(current, {
      ...restored,
      publication_id: 2,
      identity: { ...restored.identity, plan_revision: 1 },
    });
    expect(applyPlanningEnvelope(newer, restored)).toBe(newer);
    expect(applyPlanningStatus(newer, status)).toBe(newer);
  });
  it("validates Rust enum shapes, progress, safe publications, and sanitized failures", () => {
    for (const update of [
      "Preparing",
      { SafeOffer: publication },
      { SafeStep: publication },
      { Stopped: { reason: "ReplayMismatch", last_safe_publication: publication } },
      { Failed: "Worker" },
    ]) {
      expect(
        decodeServerMessage(
          {
            type: "planning_update",
            protocol_version: 3,
            game_id: "game",
            envelope: { ...offer, update },
          },
          "game",
        ).type,
      ).toBe("planning_update");
    }
    for (const change of [
      { identity: { ...offer.identity, generation_id: -1 } },
      { progress: { ...offer.progress, recorded_answers: "2" } },
      { recorded_request_ids: [42] },
      { recorded_request_ids: [""] },
      { reset_revision: -1 },
      { reset_revision: "1" },
      { editing_movement: "yes" },
      { movement_edit_revision: -1 },
      { recorded_decisions: [{ player: "b", option_id: "move", payload: "invalid" }] },
      { update: { Failed: "private engine error" } },
      { update: { SafeOffer: { ...publication, choice: { options: [] } } } },
    ]) {
      expect(() =>
        decodeServerMessage(
          {
            type: "planning_update",
            protocol_version: 3,
            game_id: "game",
            envelope: { ...offer, ...change },
          },
          "game",
        ),
      ).toThrow();
    }
  });
});

describe("secondary draft", () => {
  const secondary: SecondaryDraftStatus = {
    card: "pok7technology",
    played_by: "a",
    window_open: false,
    seats_before: null,
    can_start: true,
    has_draft: true,
    identity: offer.identity,
    ready: false,
    application: null,
  };
  // The tactical half of the status says nothing about the secondary draft.
  const round = (over: Partial<SecondaryDraftStatus> = {}): PlanningStatusMsg => ({
    ...status,
    available: false,
    has_draft: false,
    identity: null,
    secondary: { ...secondary, ...over },
  });

  it("is its own slot: fed by the status's secondary part and its own publications", () => {
    let state = applySecondaryStatus(initialPlanningState, null, round());
    expect(state.availability?.available).toBe(true);
    expect(state.availability?.identity).toEqual(offer.identity);
    state = applyPlanningEnvelope(state, offer);
    expect(planningChoice(state)?.nonce).toBe("planning:10:2:3");
    // The same round's next status keeps the draft.
    expect(applySecondaryStatus(state, secondary, round({ ready: true })).envelope).toBe(offer);
  });

  it("starts afresh for another strategic action, and ends with its window", () => {
    const drafted = applyPlanningEnvelope(
      applySecondaryStatus(initialPlanningState, null, round()),
      offer,
    );
    expect(
      applySecondaryStatus(drafted, secondary, round({ card: "pok8imperial", has_draft: false }))
        .envelope,
    ).toBeNull();
    expect(applySecondaryStatus(drafted, secondary, { ...status, secondary: null })).toBe(
      initialPlanningState,
    );
  });

  it("offers no draft question while the server submits the draft", () => {
    const state = applyPlanningEnvelope(
      applySecondaryStatus(
        initialPlanningState,
        null,
        round({ application: { applied: 0, total: 2, state: "applying", message: "" } }),
      ),
      offer,
    );
    expect(planningChoice(state)).toBeNull();
  });

  it("decodes secondary statuses, updates and results, and refuses damaged ones", () => {
    const decoded = decodeServerMessage(round({ seats_before: 1, window_open: true }), "game");
    expect(decoded.type === "planning_status" && decoded.secondary?.seats_before).toBe(1);
    expect(
      decodeServerMessage(
        { type: "planning_update", protocol_version: 3, game_id: "game", draft: "secondary", envelope: offer },
        "game",
      ).type,
    ).toBe("planning_update");
    const complete = {
      ...offer,
      awaiting_answer: false,
      update: { Stopped: { reason: "SecondaryComplete", last_safe_publication: null } },
    };
    expect(() =>
      decodeServerMessage(
        { type: "planning_update", protocol_version: 3, game_id: "game", draft: "secondary", envelope: complete },
        "game",
      ),
    ).not.toThrow();
    expect(() =>
      decodeServerMessage({ ...round(), secondary: { ...secondary, ready: "yes" } }, "game"),
    ).toThrow();
    expect(() =>
      decodeServerMessage(
        { type: "planning_result", protocol_version: 3, game_id: "game", draft: "strategic", identity: null, rejection: null },
        "game",
      ),
    ).toThrow();
  });
});
