import { test, expect } from './fixtures/test';
import { agents } from './fixtures/handlers';

test('agent detail with populated reputation chart', async ({ page, openPage }) => {
  await openPage(`/agents/${agents[0].id}`);
  await expect(page.getByRole('heading', { name: agents[0].name })).toBeVisible();
  await expect(page.locator('.recharts-line-curve')).toBeVisible();
  await expect(page).toHaveScreenshot('agent-detail.png');
});
