import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { openRound } from "./round";

// A complete draft marked ready: the server submits it when the window reaches this seat.
test("secondary drafts: complete and ready", async ({ page }, testInfo) => {
  const round = await openRound(page);
  round.status();
  await round.openDraft();
  round.stopped("SecondaryComplete", 2);
  await page.getByTestId("secondary-draft-ready-btn").click();
  round.status({ ready: true });
  await page.getByTestId("secondary-draft-ready").waitFor();
  await shot(page, testInfo, "4-ready");
});
