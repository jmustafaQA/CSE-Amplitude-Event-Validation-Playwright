// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

const REPORT_ENV = process.env.REPORT_ENV || 'qa';
const BASE_URL =
  process.env.BASE_URL || (REPORT_ENV === 'live' ? 'https://www.commonsense.org' : 'https://qa.commonsense.org');

// dashboard-reporter is a no-op unless PW_DASH_EVENTS is set — the CSE Launcher dashboard sets
// it when it spawns this repo, to get live, structured per-test progress events instead of
// scraping the `list` reporter's raw text output. See reporters/dashboard-reporter.ts.
const REPORTERS: [string, any][] = [
  ['list', undefined],
  ['./reporters/markdown-reporter.ts', undefined],
];
if (process.env.PW_DASH_EVENTS) REPORTERS.push(['./reporters/dashboard-reporter.ts', undefined]);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: REPORTERS,
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
