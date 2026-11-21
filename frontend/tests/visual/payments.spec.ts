import { test, expect } from './fixtures/test';

test('payment history with ten payments', async ({ page, openPage }) => {
  await openPage('/payments');
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page).toHaveScreenshot('payments.png');
});
