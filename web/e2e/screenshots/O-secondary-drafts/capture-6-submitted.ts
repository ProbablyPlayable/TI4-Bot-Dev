import { test } from "@playwright/test";
import { shot } from "../_shared/shot";
import { openRound } from "./round";

// The window reached this seat and the server answered it from the draft.
test("secondary drafts: submitted from the draft", async ({ page }, testInfo) => {
  const round = await openRound(page);
  round.status();
  await round.openDraft();
  round.stopped("SecondaryComplete", 2);
  round.applied({
    applied: 2,
    total: 2,
    state: "applied",
    message: "Recorded draft choices applied. Continue in Live for any further decisions.",
  });
  await page.getByTestId("secondary-draft-state").filter({ hasText: "Submitted" }).waitFor();
  await shot(page, testInfo, "6-submitted", {
    of: page.getByTestId("secondary-draft-status"),
    pad: 12,
  });
});
