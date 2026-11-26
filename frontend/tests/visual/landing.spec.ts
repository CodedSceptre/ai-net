import { test, expect } from './fixtures/test';

test('landing page', async ({ page, openPage }) => {
  await openPage('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page).toHaveScreenshot('landing.png');
});
