import { test } from "@playwright/test";
import type { EngineChoice } from "../../../src/protocol/types";
import { actor } from "../_shared/fixtures";
import { shot } from "../_shared/shot";
import { followQuestion, openRound } from "./round";

const produce = {
  player: actor,
  prompt: "produce in 18 (4 left)",
  context: {
    subtype: "produce_unit",
    source: { Rule: "68" },
    target: { System: "18" },
    outstanding: [{ kind: "production_capacity", amount: 4, paid: 0 }],
  },
  options: [
    {
      id: "build|infantry|2",
      kind: "produce",
      label: "2x infantry for 1",
      payload: { unit: "infantry", cost: 1, count: 2, available_resources: 4 },
    },
    {
      id: "build|carrier|1",
      kind: "produce",
      label: "1x carrier for 3",
      payload: { unit: "carrier", cost: 3, count: 1, available_resources: 4 },
    },
    { id: "done_producing", kind: "decline", label: "produce nothing further" },
  ],
} as unknown as EngineChoice;

// Following Warfare continues into home production, still in the draft.
test("secondary drafts: Warfare home production", async ({ page }, testInfo) => {
  const round = await openRound(page, "pok6warfare");
  round.status();
  await round.openDraft();
  round.offer(
    followQuestion("pok6warfare", "spend a strategy token to produce at home", "produce"),
    0,
  );
  await page.getByTestId("secondary-yes-btn").click();
  round.offer(produce, 1);
  await page.getByTestId("production-builder-drawer").waitFor();
  await shot(page, testInfo, "9-warfare");
});
