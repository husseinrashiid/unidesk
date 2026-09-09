import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "local-academic.spec.ts",
  timeout: 90000,
  workers: 1,
  reporter: "list",
  outputDir: ".local/playwright-academic",
  use: {
    baseURL: "http://127.0.0.1:1430",
    headless: true,
    channel: "msedge",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1430 --strictPort --configLoader runner",
    url: "http://127.0.0.1:1430",
    env: { UNIDESK_DEV_DB: `.local/e2e/academic-${Date.now()}/unidesk.db` },
  },
});
