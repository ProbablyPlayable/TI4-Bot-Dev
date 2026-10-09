import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Local play on a Pixel 9 in portrait. Needs the engine: `scripts/build-wasm.sh`.
const WASM = fileURLToPath(new URL("../src/session/ti4.wasm", import.meta.url));
test.skip(!existsSync(WASM), "the engine is not built: run web2/scripts/build-wasm.sh");
test.setTimeout(120_000);

test("phone: a game of eight is played through the decision list", async ({ page }) => {
  await page.goto("/?local=3&players=8&humans=1");
  const send = page.getByRole("button", { name: "Send" });
  const pane = (name: string) =>
    page.getByRole("navigation", { name: "Panes" }).getByRole("button", { name });
  await expect(send).toBeDisabled();
  await page.screenshot({ path: "shots/phone/local/first-choice.png", animations: "disabled" });
  for (let count = 0; count < 12; count++) {
    const system = page.locator("g.system.target");
    if (await system.count()) {
      await pane("Map").click();
      await system.first().click();
      await page.screenshot({
        path: "shots/phone/local/system-choice.png",
        animations: "disabled",
      });
    } else {
      await pane("Action").click();
      const rows = page.locator("#step-panel").getByRole("button", { pressed: false });
      // A tactical action when there is one, so that the run has a choice on the map.
      const tactical = rows.and(page.getByRole("button", { name: "Take a tactical action" }));
      await ((await tactical.count()) ? tactical : rows).first().click();
    }
    // The main button is under every pane, in view.
    await expect(send).toBeInViewport({ ratio: 1 });
    await send.click();
    await expect(send).toBeDisabled();
    // Nothing is cut at the side.
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  expect(existsSync("shots/phone/local/system-choice.png"), "a system was chosen on the map").toBe(
    true,
  );
  await pane("Players").click();
  await page.screenshot({ path: "shots/phone/local/players.png", animations: "disabled" });
});
