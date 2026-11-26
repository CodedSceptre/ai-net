import { test, expect } from './fixtures/test';
import { agents } from './fixtures/handlers';

test('agent registry with six cards', async ({ page, openPage }) => {
  await openPage('/agents');
  await expect(page.getByTestId(/^agent-card-visual-agent-/)).toHaveCount(agents.length);
  await expect(page.getByTestId('agents-page-skeleton')).toHaveCount(0);
  await expect(page).toHaveScreenshot('agents.png');
});
