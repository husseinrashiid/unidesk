import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'tests/browser',testMatch:'platform.spec.ts',timeout:120000,workers:1,reporter:'list',outputDir:'.local/playwright-platform',
  use:{baseURL:'http://127.0.0.1:1432',headless:true,hasTouch:true,channel:'msedge',screenshot:'only-on-failure'},
  webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1432 --strictPort --configLoader runner',url:'http://127.0.0.1:1432',env:{UNIDESK_DEV_DB:`.local/e2e/platform-${Date.now()}/unidesk.db`}},
});
