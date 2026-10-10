import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { followQuestion, openRound, research } from "./round";

// Following Technology continues into the research pick, still in the draft.
test("secondary drafts: Technology research pick", async ({ page }, testInfo) => {
  const round = await openRound(page);
  round.status();
  await round.openDraft();
  round.offer(
    followQuestion("pok7technology", "spend a strategy token and 4 resources to research", "spend"),
    0,
  );
  await page.getByTestId("secondary-yes-btn").click();
  round.offer(research, 1);
  await page.getByText("Antimass Deflectors").first().waitFor();
  await shot(page, testInfo, "3-research");
});
