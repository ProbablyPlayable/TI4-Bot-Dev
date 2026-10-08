import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { openRound } from "./round";

// The primary resolved and the live window is open, with one seat still ahead of this one.
test("secondary drafts: window open, one seat ahead", async ({ page }, testInfo) => {
  const round = await openRound(page);
  round.status();
  await round.openDraft();
  round.stopped("SecondaryComplete", 2);
  round.status({ ready: true, window_open: true, seats_before: 1 });
  await page.getByText("1 seat before you").waitFor();
  await shot(page, testInfo, "5-window-open", {
    of: page.getByTestId("secondary-draft-status"),
    pad: 12,
  });
});
