import { test as base, expect } from '@playwright/test';
import { mockWalletConnection, setTheme } from '../utils';

export { expect };

export const test = base.extend<{ openPage: (route: string) => Promise<void> }>({
  openPage: async ({ page }, use) => {
    await page.clock.setFixedTime(new Date('2026-08-20T10:06:00Z'));
    await page.addInitScript(() => {
      localStorage.setItem('ai-net-visual-fixtures', 'true');
      localStorage.setItem('i18nextLng', 'en');
    });
    await mockWalletConnection(page);
    await setTheme(page, 'light');
    await page.routeWebSocket('**/*', () => {});
    await use(async (route) => {
      await page.goto(route);
      await page.evaluate(() => document.fonts.ready);
    });
  },
});
