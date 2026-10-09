import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

// A real game of the wasm engine in the shell: `?local=<seed>&players=8&humans=<mask>`.
// Needs the engine: `scripts/build-wasm.sh`. Screenshots go to shots/local/.
const WASM = fileURLToPath(new URL("../src/session/ti4.wasm", import.meta.url));
test.skip(!existsSync(WASM), "the engine is not built: run web2/scripts/build-wasm.sh");
test.use({ viewport: { width: 1920, height: 1080 } });
// The engine plays the other seats between two choices, which takes a moment.
test.setTimeout(120_000);

const panel = (page: Page) => page.locator("#step-panel");
const send = (page: Page) => page.getByRole("button", { name: "Send" });
const heading = (page: Page) => panel(page).getByRole("heading").first();

/** Answers the open choice with its first row, or with the first system when it is on the board. */
async function answer(page: Page) {
  const system = page.locator("g.system.target");
  await ((await system.count()) ? system : panel(page).getByRole("button", { pressed: false }))
    .first()
    .click();
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  // The next choice has nothing staged.
  await expect(send(page)).toBeDisabled();
}

test("a game of eight is played through the decision list", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/?local=3&players=8&humans=1");
  await expect(send(page)).toBeDisabled();
  await expect(page.locator("g.system")).toHaveCount(55);
  await expect(page.getByRole("region", { name: "Players" }).locator("tbody tr")).toHaveCount(8);
  await expect(page.getByText("Round 1 · Strategy phase")).toBeVisible();
  await expect(heading(page)).toHaveText("Choose a strategy card");
  await page.screenshot({ path: "shots/local/first-choice.png", animations: "disabled" });

  // Enter does what the main button says, and a number key stages a row.
  await page.keyboard.press("2");
  await expect(panel(page).getByRole("button", { pressed: true })).toHaveCount(1);
  await expect(page.getByText("Not sent")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel(page).getByRole("button", { pressed: true })).toHaveCount(0);
  await page.keyboard.press("2");
  await page.keyboard.press("Enter");
  await expect(send(page)).toBeDisabled();

  for (let count = 1; count < 30; count++) {
    await answer(page);
  }
  await expect(page.getByText("Round 1 · Strategy phase")).toHaveCount(0);
  await page.screenshot({ path: "shots/local/after-30-choices.png", animations: "disabled" });
  expect(errors).toEqual([]);
});

test("a choice of systems is also made on the board", async ({ page }) => {
  await page.goto("/?local=3&players=8&humans=1");
  await expect(send(page)).toBeDisabled();
  // Play until the game asks for a system.
  for (let count = 0; count < 40; count++) {
    if ((await heading(page).textContent()) === "Activate a system") {
      break;
    }
    const tactical = panel(page).getByRole("button", { name: "Take a tactical action" });
    if (await tactical.count()) {
      await tactical.click();
      await send(page).click();
      await expect(heading(page)).toHaveText("Activate a system");
    } else {
      await answer(page);
    }
  }
  await expect(heading(page)).toHaveText("Activate a system");
  const target = page.locator("g.system.target").first();
  await target.click();
  await expect(page.locator("g.system.chosen")).toHaveCount(1);
  await expect(send(page)).toBeEnabled();
  // The board is the picker: the panel has no list of the systems.
  await expect(panel(page).getByRole("button", { name: /^Activate / })).toHaveCount(0);
  await expect(panel(page).getByText("Selected on the board.")).toBeVisible();
  await page.screenshot({ path: "shots/local/system-choice.png", animations: "disabled" });
  await send(page).click();
  await expect(page.locator("g.system.target")).toHaveCount(0);
});

test("hotseat: the viewer is the seat that is asked", async ({ page }) => {
  await page.goto("/?local=3&players=8&humans=255");
  await expect(send(page)).toBeDisabled();
  const me = page
    .getByRole("region", { name: "Players" })
    .locator('tbody tr:has([title="Active player"]) th');
  const seen = new Set<string>();
  for (let count = 0; count < 16; count++) {
    seen.add((await me.first().textContent()) ?? "");
    await answer(page);
  }
  // The strategy phase asks every seat once.
  expect(seen.size).toBe(8);
});

test("an inspected system shows its forces", async ({ page }) => {
  await page.goto("/?local=3&players=8&humans=1");
  await expect(send(page)).toBeDisabled();
  await page.getByRole("button", { name: /^Inspect .*system 01/ }).click();
  await expect(page.getByRole("heading", { name: "Jord - Sol · 01" })).toBeVisible();
  await expect(page.getByText("2 Carriers")).toBeVisible();
  await page.screenshot({ path: "shots/local/inspector.png", animations: "disabled" });
});
