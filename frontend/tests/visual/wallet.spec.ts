import { test, expect } from './fixtures/test';
import { MOCK_WALLET_PUBKEY } from './utils';

test('connected wallet with a funded balance', async ({ page, openPage }) => {
  await openPage('/wallet');
  await expect(page.getByText(`${MOCK_WALLET_PUBKEY.slice(0, 8)}...${MOCK_WALLET_PUBKEY.slice(-8)}`, { exact: true })).toBeVisible();
  await expect(page.getByText(/125\.75/).first()).toBeVisible();
  await expect(page.getByTestId('wallet-page-skeleton')).toHaveCount(0);
  await expect(page).toHaveScreenshot('wallet.png');
});
