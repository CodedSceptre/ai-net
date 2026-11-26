import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/visual',
  // The older theme suite keeps its own checked-in images.
  testIgnore: '**/*.visual.spec.ts',
  snapshotPathTemplate: '{testDir}/baselines/{projectName}/{arg}{ext}',
  forbidOnly: !!process.env.CI,
  workers: 1,
  updateSnapshots: 'none',
  reporter: [['html', { outputFolder: 'playwright-report-visual', open: 'never' }], ['list']],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.001,
      animations: 'disabled',
      fullPage: true,
    },
  },
  use: {
    baseURL,
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: {
      ...devices['Pixel 7'],
      defaultBrowserType: 'chromium',
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    } },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
