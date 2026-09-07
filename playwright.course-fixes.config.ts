import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/browser', testMatch: 'course-fixes.spec.ts', timeout: 90000,
  workers: 1, reporter: 'list', outputDir: '.local/course-fixes-results',
  use: { baseURL: 'http://127.0.0.1:1429', channel: 'msedge', headless: true, viewport: { width: 2560, height: 1440 }, screen: { width: 2560, height: 1440 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1429 --strictPort --configLoader runner', url: 'http://127.0.0.1:1429', env: { UNIDESK_DEV_DB: `.local/e2e/course-fixes-${Date.now()}/unidesk.db` } },
});
