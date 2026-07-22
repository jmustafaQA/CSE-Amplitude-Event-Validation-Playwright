// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const REPORT_ENV = process.env.REPORT_ENV || 'qa';
const BASE_URL =
  process.env.BASE_URL || (REPORT_ENV === 'live' ? 'https://www.commonsense.org' : 'https://qa.commonsense.org');

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['./reporters/markdown-reporter.ts']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
