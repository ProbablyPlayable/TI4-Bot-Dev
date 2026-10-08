import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { followQuestion, openRound } from "./round";

// Politics draws cards: the follow is recorded, the cards are never previewed.
test("secondary drafts: stops before a draw", async ({ page }, testInfo) => {
  const round = await openRound(page, "pok3politics");
  round.status();
  await round.openDraft();
  round.offer(
    followQuestion("pok3politics", "spend a strategy token to draw two action cards", "draw"),
    0,
  );
  await page.getByTestId("secondary-yes-btn").click();
  round.stopped("KnowledgeChanged", 1);
  await page
    .getByTestId("secondary-draft-state")
    .filter({ hasText: "Recorded up to an unknown outcome" })
    .waitFor();
  await shot(page, testInfo, "7-draw", { of: page.getByTestId("secondary-draft-status"), pad: 12 });
});
