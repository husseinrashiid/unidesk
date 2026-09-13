import { defineConfig } from "@playwright/test";
const port = process.env.UNIDESK_TEST_PORT ?? "1434";
export default defineConfig({
  testDir: "tests/browser",
  testMatch: "ui-responsive.spec.ts",
  timeout: 120000,
  workers: 1,
  reporter: "list",
  outputDir: ".local/ui-responsive-results",
  use: {
    baseURL: process.env.UNIDESK_TEST_URL ?? `http://127.0.0.1:${port}`,
    channel: "msedge",
    headless: true,
    colorScheme: "dark",
    screenshot: "only-on-failure",
  },
  webServer: process.env.UNIDESK_TEST_URL
    ? undefined
    : {
        command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort --configLoader runner`,
        url: `http://127.0.0.1:${port}`,
        env: { UNIDESK_DEV_DB: `.local/e2e/ui-${Date.now()}/unidesk.db` },
      },
});
