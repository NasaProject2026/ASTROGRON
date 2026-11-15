import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120000,
  reporter: [
    ['list'],
    ['json', { outputFile: 'review/evidence/playwright-results.json' }],
    ['junit', { outputFile: 'review/evidence/playwright-junit.xml' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:3005',
    trace: 'on-first-retry',
    video: 'on',
  },
  webServer: {
    command: 'npm run start -- --port 3005',
    url: 'http://127.0.0.1:3005',
    reuseExistingServer: false,
    timeout: 120000,
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'msedge',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'webkit-desktop',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
