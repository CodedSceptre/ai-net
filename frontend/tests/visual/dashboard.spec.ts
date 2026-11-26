import { test, expect } from './fixtures/test';

test('dashboard with populated network metrics and recent task activity', async ({ page, openPage }) => {
  await openPage('/dashboard');
  await expect(page.getByTestId('network-stats-widget')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Agent performance' }).getByRole('listitem')).toHaveCount(3);
  await expect(page.locator('a[href="/tasks/visual-task-fixture"]')).toBeVisible();
  await expect(page).toHaveScreenshot('dashboard.png');
});
