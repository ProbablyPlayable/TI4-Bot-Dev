import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Local play on a Pixel 9 in portrait. Needs the engine: `scripts/build-wasm.sh`.
const WASM = fileURLToPath(new URL("../src/session/ti4.wasm", import.meta.url));
test.skip(!existsSync(WASM), "the engine is not built: run web2/scripts/build-wasm.sh");
test.setTimeout(120_000);

test("phone: a game of eight is played through the decision list", async ({ page }) => {
  await page.goto("/?local=3&players=8&humans=1");
  // The main button of the footer: "Send", "Activate system", "Move nothing".
  const send = page.locator('footer button[aria-keyshortcuts="Enter"]');
  const saved = page.getByRole("navigation", { name: "Local game" });
  const pane = (name: string) =>
    page.getByRole("navigation", { name: "Panes" }).getByRole("button", { name });
  await expect(send).toBeDisabled();
  await page.screenshot({ path: "shots/phone/local/first-choice.png", animations: "disabled" });
  // A later movement moves nothing: the main button already says so.
  let moved = false;
  for (let count = 0; count < 12; count++) {
    const before = (await saved.textContent()) ?? "";
    const system = page.locator("g.system.target");
    if (await system.count()) {
      await pane("Map").click();
      // The system next to the home of this seat, so that the movement has ships in range.
      const near = system.filter({ hasText: "#23" });
      await ((await near.count()) ? near : system).first().click();
      await page.screenshot({
        path: "shots/phone/local/system-choice.png",
        animations: "disabled",
      });
    } else if (await send.isDisabled()) {
      await pane("Action").click();
      const rows = page.locator("#step-panel").getByRole("button", { pressed: false });
      // A tactical action when there is one, so that the run has a choice on the map.
      const tactical = rows.and(page.getByRole("button", { name: "Take a tactical action" }));
      await ((await tactical.count()) ? tactical : rows).first().click();
    } else if (!moved) {
      // The first movement: the fleet of a system opens in a sheet over the map.
      moved = true;
      await pane("Map").click();
      await page.locator("g.system").filter({ hasText: "#01" }).click();
      const sheet = page.getByRole("group", { name: /^Move from / });
      await sheet.getByRole("button", { name: /^Carrier 1 of / }).click();
      await expect(send).toHaveText(/Move fleet/);
      await page.screenshot({ path: "shots/phone/local/movement.png", animations: "disabled" });
    }
    // The main button is under every pane, in view.
    await expect(send).toBeInViewport({ ratio: 1 });
    await send.click();
    await expect(saved).not.toHaveText(before);
    await expect(send).toBeVisible();
    // Nothing is cut at the side.
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  expect(existsSync("shots/phone/local/system-choice.png"), "a system was chosen on the map").toBe(
    true,
  );
  expect(existsSync("shots/phone/local/movement.png"), "a ship was moved from the sheet").toBe(
    true,
  );
  await pane("Players").click();
  await page.screenshot({ path: "shots/phone/local/players.png", animations: "disabled" });
});
