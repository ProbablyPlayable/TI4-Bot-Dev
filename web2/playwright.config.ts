import { defineConfig, devices } from "@playwright/test";

// `npm run shots` writes screenshots of every example to shots/. They are for review, not assertions.
const port = process.env.WEB2_PORT ?? "3190";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "line",
  use: { baseURL: `http://127.0.0.1:${port}`, ...devices["Desktop Chrome"], deviceScaleFactor: 1 },
  webServer: {
    command: `exec npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    wait: { stdout: new RegExp(`Local:\\s+http://127\\.0\\.0\\.1:${port}/`) },
    reuseExistingServer: true,
    timeout: 20_000,
  },
});
