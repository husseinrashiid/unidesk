import { defineConfig } from "@playwright/test";
const external = process.env.UNIDESK_TEST_URL;
const run = Date.now();
export default defineConfig({
  testDir: "tests/browser",
  timeout: 60000,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: ".local/playwright-results",
  use: {
    baseURL: external ?? "http://127.0.0.1:1421",
    headless: true,
    channel: "msedge",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: external
    ? undefined
    : [
        {
          name: "phase1",
          testMatch: "workspace.spec.ts",
          use: { baseURL: "http://127.0.0.1:1421" },
        },
        {
          name: "phase2",
          testMatch: "phase2.spec.ts",
          use: { baseURL: "http://127.0.0.1:1424" },
        },
        {
          name: "phase3",
          testMatch: "phase3.spec.ts",
          use: {
            baseURL: "http://127.0.0.1:1425",
            viewport: { width: 2560, height: 1440 },
            screen: { width: 2560, height: 1440 },
          },
        },
        {name:'phase3-workflows',testMatch:'phase3-workflows.spec.ts',use:{baseURL:'http://127.0.0.1:1426',viewport:{width:1920,height:1200}}},
        {name:'phase4',testMatch:'phase4.spec.ts',use:{baseURL:'http://127.0.0.1:1427',viewport:{width:1920,height:1200}}},
        {name:'phase4-ai',testMatch:'phase4-ai.spec.ts',use:{baseURL:'http://127.0.0.1:1428',viewport:{width:1920,height:1200}}},
      ],
  webServer:
    external || process.env.UNIDESK_MANAGED_TEST_SERVERS
      ? undefined
      : [1421, 1424, 1425, 1426, 1427, 1428].map((port) => ({
          command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort --configLoader runner`,
          url: `http://127.0.0.1:${port}`,
          reuseExistingServer: false,
          env: { UNIDESK_DEV_DB: `.local/e2e/${run}-${port}/unidesk.db` },
        })),
});
