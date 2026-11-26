import { test, expect } from './fixtures/test';
import { MOCK_TASK_ID } from './utils';

test('task detail with a five-node DAG', async ({ page, openPage }) => {
  await openPage(`/tasks/${MOCK_TASK_ID}`);
  await expect(page.getByTestId('dag-visualization').locator('.react-flow__node')).toHaveCount(5);
  await expect(page.locator('#ws-status')).toHaveAttribute('data-ws-state', 'connected');
  await expect(page).toHaveScreenshot('task-detail.png');
});
