import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { openRound } from "./round";

// The card is chosen and its primary is still resolving: the follower gets a tab at once.
test("secondary drafts: announced while the primary resolves", async ({ page }, testInfo) => {
  const round = await openRound(page);
  round.status();
  await page.getByTestId("secondary-draft-tab").waitFor();
  await shot(page, testInfo, "1-announced");
});
