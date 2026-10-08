import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { followQuestion, openRound } from "./round";

// The draft opens on the ordinary secondary question, asked on a private copy of the game.
test("secondary drafts: follow or skip", async ({ page }, testInfo) => {
  const round = await openRound(page);
  round.status();
  await round.openDraft();
  round.offer(
    followQuestion("pok7technology", "spend a strategy token and 4 resources to research", "spend"),
    0,
  );
  await page.getByTestId("strategy-secondary-panel").waitFor();
  await shot(page, testInfo, "2-follow-or-skip");
});
