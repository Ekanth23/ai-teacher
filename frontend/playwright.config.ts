import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser E2E foundation for the AI Teacher frontend.
 *
 * Uses the existing Vite dev server (started automatically via webServer) so
 * no manual server needs to be running for normal E2E execution.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
    {
      name: "mobile-chromium",
      use: { browserName: "chromium", ...devices["Pixel 5"] },
    },
  ],
});
