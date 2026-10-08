import { defineConfig, devices } from "@playwright/test";

// `npm run shots` writes screenshots of every example to shots/. They are for review.
// The examples also assert that the open step needs no vertical scroll at 1920×1080.
// The "phone" project shows the same examples on a Pixel 9 in portrait (e2e/phone.spec.ts).
const port = process.env.WEB2_PORT ?? "3190";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "line",
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices["Desktop Chrome"], deviceScaleFactor: 1 },
  projects: [
    { name: "desktop", testIgnore: /phone\.spec\.ts/ },
    {
      // The installed app has the whole screen of the phone, with no browser bars: 1080×2424 at
      // the default display size of a Pixel 9. (The preset of Playwright assumes a larger one.)
      name: "phone",
      testMatch: /phone\.spec\.ts/,
      use: {
        ...devices["Pixel 9"],
        viewport: { width: 412, height: 923 },
        deviceScaleFactor: 2.625,
      },
    },
  ],
  webServer: {
    command: `exec npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    wait: { stdout: new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${port}/`) },
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
