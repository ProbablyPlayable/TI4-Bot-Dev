import { expect, test, type Page } from "@playwright/test";
import { EXAMPLE_IDS as EXAMPLES } from "../src/mock/exampleList";

// The phone shell on a Pixel 9 in portrait: one pane at a time, the footer of the action under each.
// Run: `npm run shots -- --project=phone`. The screenshots go to shots/phone/.

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `shots/phone/${name}.png`, animations: "disabled" });
const pane = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Panes" }).getByRole("button", { name });

test.describe("examples", () => {
  for (const example of EXAMPLES) {
    test(`phone ${example}`, async ({ page }) => {
      await page.goto(`/?example=${example}`);
      // The panel is in the page but not in view while the choice is on the map.
      await page.locator("#step-panel").waitFor({ state: "attached" });
      await shot(page, `examples/${example}`);
      // A pane may scroll down. Nothing is cut at the side, and the main button is in view.
      const width = page.viewportSize()!.width;
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const content = page.locator("#step-panel > div.overflow-y-auto");
      const overflow = await content.evaluate(
        (element) => element.scrollWidth - element.clientWidth,
      );
      expect(overflow, "the step content is wider than the screen").toBeLessThanOrEqual(0);
      for (const button of await page.locator("main > footer button").all()) {
        await expect(button).toBeInViewport({ ratio: 1 });
      }
      await pane(page, "Action").click();
      await shot(page, `action/${example}`);
    });
  }
});

test.describe("flows", () => {
  test("the three panes", async ({ page }) => {
    await page.goto("/?example=live-strategic");
    for (const name of ["Map", "Players", "Action"]) {
      await pane(page, name).click();
      await expect(pane(page, name)).toHaveAttribute("aria-pressed", "true");
      await shot(page, `flow/pane-${name.toLowerCase()}`);
    }
  });

  test("a tap on a system opens the inspector; two fingers zoom", async ({ page }) => {
    await page.goto("/?example=live-picker");
    await pane(page, "Map").click();
    const svg = page.locator(".galaxy svg");
    const before = await svg.getAttribute("viewBox");
    const box = (await svg.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Two fingers that move apart. Playwright has no pinch, so the pointer events are sent.
    await svg.evaluate(
      (element, [x, y]) => {
        const send = (type: string, id: number, dx: number) =>
          (type === "pointerdown" ? element : document).dispatchEvent(
            new PointerEvent(type, {
              pointerId: id,
              pointerType: "touch",
              button: 0,
              clientX: x + dx,
              clientY: y,
              bubbles: true,
            }),
          );
        send("pointerdown", 1, -40);
        send("pointerdown", 2, 40);
        send("pointermove", 1, -120);
        send("pointermove", 2, 120);
        send("pointerup", 1, -120);
        send("pointerup", 2, 120);
      },
      [cx, cy],
    );
    const after = await svg.getAttribute("viewBox");
    const width = (viewBox: string | null) => Number(viewBox!.split(" ")[2]);
    expect(width(after) * 2.9).toBeLessThan(width(before));
    await shot(page, "flow/pinch");
    await page.getByRole("button", { name: /^Inspect .*system 40/ }).tap();
    await expect(page.getByRole("button", { name: "Close system details" })).toBeVisible();
    await shot(page, "flow/inspector");
  });

  test("a payment: the pane goes to the map, the main button stays", async ({ page }) => {
    await page.goto("/?example=live-strategic");
    await expect(pane(page, "Map")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /Exhaust Jord/ }).tap();
    await expect(page.locator("main > footer")).toContainText("Jord 2");
    await shot(page, "flow/pay");
  });

  test("a choice of a player opens the player table", async ({ page }) => {
    await page.goto("/?example=live-picker-4p");
    await page
      .locator("#step-panel")
      .getByRole("button", { name: /Play an action card/ })
      .tap();
    await page.locator("#step-panel").getByRole("button", { name: /Spy/ }).tap();
    await expect(pane(page, "Players")).toHaveAttribute("aria-pressed", "true");
    await shot(page, "flow/pick-player");
  });

  test("reference sheets are in a menu and cover the pane", async ({ page }) => {
    await page.goto("/?example=live-strategic");
    await page.getByRole("button", { name: "Reference and more" }).tap();
    await page.getByRole("menuitem", { name: "Objectives" }).tap();
    await expect(page.getByRole("complementary", { name: "Objectives" })).toBeVisible();
    await shot(page, "flow/reference");
  });

  test("the app can be installed", async ({ page, request }) => {
    await page.goto("/");
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const manifest = await (await request.get(href!)).json();
    expect(manifest.display).toBe("fullscreen");
    expect(manifest.orientation).toBe("portrait");
    for (const icon of manifest.icons) {
      expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
    }
  });
});
