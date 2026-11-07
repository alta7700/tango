import { defineConfig } from '@playwright/test';

// Проверяем именно опубликованные статические сборки в установленном Chrome.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'npm run preview:standalone', url: 'http://127.0.0.1:4273', reuseExistingServer: false },
    { command: 'npm run preview:yandex', url: 'http://127.0.0.1:4274', reuseExistingServer: false },
  ],
});
