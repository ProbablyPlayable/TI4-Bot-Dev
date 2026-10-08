import { describe, expect, it } from "vitest";
import { describeSecondaryDraft } from "./secondaryDraft.ts";
import { initialPlanningState, type PlanningState } from "../protocol/planning.ts";
import type {
  PlanningEnvelope,
  PlanningUpdate,
  SecondaryDraftStatus,
} from "../protocol/types.ts";

const identity = { checkpoint_id: 4, generation_id: 1, plan_revision: 2 };
const status = (over: Partial<SecondaryDraftStatus> = {}): SecondaryDraftStatus => ({
  card: "pok7technology",
  played_by: "a",
  window_open: false,
  seats_before: null,
  can_start: true,
  has_draft: true,
  identity,
  ready: false,
  application: null,
  ...over,
});
const planning = (
  update: PlanningUpdate,
  recorded: number,
  over: Partial<PlanningEnvelope> = {},
): PlanningState => ({
  ...initialPlanningState,
  current: true,
  envelope: {
    publication_id: 3,
    identity,
    awaiting_answer: false,
    recorded_request_ids: [],
    assumptions: [],
    progress: {
      recorded_answers: recorded,
      replayed: recorded,
      remaining: 0,
      completed_steps: 1,
      nested_answers_since_checkpoint: 0,
    },
    update,
    ...over,
  },
});
const stopped = (reason: "SecondaryComplete" | "ReplayMismatch" | "KnowledgeChanged") =>
  ({ Stopped: { reason, last_safe_publication: null } }) satisfies PlanningUpdate;

describe("describeSecondaryDraft", () => {
  it("names the card and says the primary is still resolving", () => {
    const view = describeSecondaryDraft(status({ has_draft: false, identity: null }), {
      ...initialPlanningState,
    });
    expect(view.cardName).toBe("Technology");
    expect(view.stage).toBe("Primary still resolving");
    expect(view.state).toBe("Not drafted");
    expect(view.canReady).toBe(false);
    expect(view.canReset).toBe(false);
  });

  it("offers Ready once a complete draft has recorded answers", () => {
    const view = describeSecondaryDraft(status(), planning(stopped("SecondaryComplete"), 2));
    expect(view.state).toBe("Draft complete");
    expect(view.canReady).toBe(true);
    expect(view.canReset).toBe(true);
  });

  it("keeps a draft that ends in a draw usable: the recorded follow is still submitted", () => {
    const view = describeSecondaryDraft(status(), planning(stopped("KnowledgeChanged"), 1));
    expect(view.state).toBe("Recorded up to an unknown outcome");
    expect(view.canReady).toBe(true);
  });

  it("does not offer Ready for an empty, mismatched, refreshing or busy draft", () => {
    expect(describeSecondaryDraft(status(), planning(stopped("SecondaryComplete"), 0)).canReady).toBe(
      false,
    );
    const mismatch = describeSecondaryDraft(status(), planning(stopped("ReplayMismatch"), 2));
    expect(mismatch.canReady).toBe(false);
    expect(mismatch.state).toBe("No longer fits the game");
    const complete = planning(stopped("SecondaryComplete"), 2);
    expect(describeSecondaryDraft(status(), { ...complete, current: false }).canReady).toBe(false);
    expect(describeSecondaryDraft(status(), { ...complete, busy: true }).canReady).toBe(false);
  });

  it("says so when the seat cannot follow the card at all", () => {
    const view = describeSecondaryDraft(status(), planning(stopped("SecondaryComplete"), 0));
    expect(view.state).toBe("Nothing to decide");
    expect(view.hint).toMatch(/cannot follow this card/);
    expect(view.canReady).toBe(false);
  });

  it("counts the seats the live window asks first", () => {
    const open = (seats_before: number) =>
      describeSecondaryDraft(status({ window_open: true, seats_before }), initialPlanningState).stage;
    expect(open(0)).toBe("Window open · you are next");
    expect(open(1)).toBe("Window open · 1 seat before you");
    expect(open(3)).toBe("Window open · 3 seats before you");
  });

  it("reports a ready draft and one the server is submitting", () => {
    const ready = describeSecondaryDraft(
      status({ ready: true }),
      planning(stopped("SecondaryComplete"), 2),
    );
    expect(ready.ready).toBe(true);
    expect(ready.hint).toMatch(/submitted for you/);
    const submitting = describeSecondaryDraft(
      status({
        application: { applied: 1, total: 2, state: "needs_decision", message: "Continue in Live." },
      }),
      planning(stopped("SecondaryComplete"), 2),
    );
    expect(submitting.submitting).toBe(true);
    expect(submitting.state).toBe("Needs your decision in Live");
    expect(submitting.hint).toBe("Continue in Live.");
    expect(submitting.canReady).toBe(false);
  });
});
