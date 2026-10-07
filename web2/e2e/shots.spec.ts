import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Screenshots of every example, next to the same example in the HTML click dummy.
// Run all: `npm run shots`. Run some: `npm run shots -- -g draft-movement`. Skip the dummy: LEGACY=0.
const EXAMPLES = [
  "draft-combat",
  "draft-start",
  "draft-movement",
  "draft-rift",
  "draft-invasion",
  "draft-production",
  "draft-review",
  "draft-cannon",
  "live-picker",
  "live-strategic",
  "live-secondary",
  "live-component",
  "live-combat",
  "live-combat-full",
  "live-invasion",
  "summary",
];
// One size: the design target is 1920×1080 or larger. Narrower screens are a non-goal (AGENTS.md).
const SIZE = { width: 1920, height: 1080 };
const LEGACY = fileURLToPath(new URL("../../web/tactical-action-demo.html", import.meta.url));
const legacy = process.env.LEGACY !== "0";

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `shots/${name}.png`, animations: "disabled" });

test.use({ viewport: SIZE });

test.describe("examples", () => {
  for (const example of EXAMPLES) {
    test(`web2 ${example}`, async ({ page }) => {
      await page.goto(`/?example=${example}`);
      await page.locator("#step-panel").waitFor();
      await shot(page, `web2/examples/${example}`);
      // The open step must fit: experts must not scroll to see the state of a step.
      const overflow = await page
        .locator("#step-panel > div:nth-of-type(2)")
        .evaluate((element) => element.scrollHeight - element.clientHeight);
      expect(overflow, "the step content needs vertical scroll").toBeLessThanOrEqual(0);
    });
    if (legacy)
      test(`legacy ${example}`, async ({ page }) => {
        await page.goto(`file://${LEGACY}`);
        await page.selectOption("#example", example);
        await shot(page, `legacy/examples/${example}`);
      });
  }
});

test.describe("flows", () => {
  test("gallery", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1500 });
    await page.goto("/?gallery");
    await shot(page, "web2/gallery");
  });

  test("edit movement and change a route", async ({ page }) => {
    await page.goto("/?example=draft-movement");
    await page.getByRole("button", { name: "Add Dreadnought from Jord" }).click();
    await page.getByRole("heading", { name: "Lodor · #26" }).hover();
    await shot(page, "web2/flow/movement-edit");
    await page.getByRole("button", { name: "Preview movement" }).click();
    await shot(page, "web2/flow/movement-committed");
  });

  for (const app of legacy ? ["web2", "legacy"] : ["web2"])
    test(`${app} assign hits in space combat`, async ({ page }) => {
      if (app === "web2") await page.goto("/?example=live-combat");
      else {
        await page.goto(`file://${LEGACY}`);
        await page.selectOption("#example", "live-combat");
      }
      await page.getByRole("button", { name: "Play Morale Boost" }).click();
      await page.getByRole("button", { name: "Roll combat dice" }).click();
      await shot(page, `${app}/flow/combat-rolled`);
      for (let turn = 0; turn < 6; turn++) {
        const pick = page
          .locator("#step-panel")
          .getByRole("button", { name: /^(Sustain damage|Destroy)/ })
          .first();
        if (!(await pick.count()) || (await pick.isDisabled())) break;
        await pick.click();
      }
      await shot(page, `${app}/flow/combat-assign`);
    });

  test("pay for production on the board", async ({ page }) => {
    await page.goto("/?example=draft-production");
    await page.getByRole("button", { name: "Res / Inf" }).click();
    await page.getByRole("button", { name: /Exhaust Jord/ }).click();
    await shot(page, "web2/flow/production-pay");
  });

  test("rule text opens on hover and stays on click", async ({ page }) => {
    await page.goto("/?example=live-strategic");
    const hint = page.getByRole("button", { name: "Rules: Leadership · Primary" });
    await expect(page.getByRole("note")).toHaveCount(0);
    await hint.hover();
    await expect(page.getByRole("note")).toContainText("Gain 3 command tokens");
    await hint.click();
    await page.mouse.move(10, 10);
    await expect(page.getByRole("note")).toBeVisible();
    await shot(page, "web2/flow/rules-hint");
  });

  test("pay on the board only", async ({ page }) => {
    await page.goto("/?example=live-strategic");
    await expect(page.locator("#step-panel").getByRole("checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: /Exhaust Jord/ }).click();
    await expect(page.locator("#step-panel")).toContainText("Jord 2");
    await shot(page, "web2/flow/strategic-pay");
  });

  test("apply a draft", async ({ page }) => {
    await page.goto("/?example=draft-combat");
    await page.locator("header").getByRole("button", { name: "Apply to Live" }).click();
    await shot(page, "web2/flow/apply-dialog");
    await page.getByRole("dialog").getByRole("button", { name: "Apply to Live" }).click();
    await shot(page, "web2/flow/applied");
  });

  test("secondary, log and history", async ({ page }) => {
    await page.goto("/?example=live-secondary");
    await page.getByRole("button", { name: "Simulate Alex (demo)" }).click();
    await shot(page, "web2/flow/secondary");
    await page
      .getByRole("navigation", { name: "Reference" })
      .getByRole("button", { name: "Log", exact: true })
      .click();
    await shot(page, "web2/flow/log");
    await page
      .getByRole("complementary", { name: "Log" })
      .getByRole("button", { name: "Inspect", exact: true })
      .first()
      .click();
    await shot(page, "web2/flow/history");
  });

  for (const viewer of ["hacan", "observer"])
    test(`live combat as ${viewer}`, async ({ page }) => {
      await page.goto(`/?example=live-combat&viewer=${viewer}`);
      await page.locator("#step-panel").waitFor();
      await shot(page, `web2/flow/combat-${viewer}`);
    });
});
