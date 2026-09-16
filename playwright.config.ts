import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 45000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', browserName: 'chromium', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev -- --port 5173', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
