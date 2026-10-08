import { test } from "@playwright/test";
import type { EngineChoice } from "../../../src/protocol/types";
import { actor } from "../_shared/fixtures";
import { shot } from "../_shared/shot";
import { followQuestion, openRound } from "./round";

const placeStructure = {
  player: actor,
  prompt: "place a structure",
  context: { subtype: "place_structure", source: { Content: "place_structure" } },
  options: [
    {
      id: "pds|18|jord",
      kind: "build",
      label: "place pds on jord",
      payload: { planet: "jord", system: "18", unit: "pds" },
    },
    { id: "decline", kind: "decline", label: "Decline" },
  ],
} as unknown as EngineChoice;

// Following Construction continues into where the structure goes, still in the draft.
test("secondary drafts: Construction placement", async ({ page }, testInfo) => {
  const round = await openRound(page, "pok4construction");
  round.status();
  await round.openDraft();
  round.offer(
    followQuestion("pok4construction", "spend a strategy token to build a structure", "build"),
    0,
  );
  await page.getByTestId("secondary-yes-btn").click();
  round.offer(placeStructure, 1);
  await page.getByTestId("planet-selection-bar").waitFor();
  await shot(page, testInfo, "8-construction");
});
