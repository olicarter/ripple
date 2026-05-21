import { test, expect, ORG_SLUG } from '../fixtures';

test.describe('Invite by email', () => {
  test('admin can see invite members section in admin panel', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/admin`);

    await expect(page.getByText('Invite members')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('invite-email-input')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send invite' })).toBeVisible();
  });

  test('send invite button is disabled when email is empty', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/admin`);

    await expect(page.getByRole('button', { name: 'Send invite' })).toBeDisabled({ timeout: 10000 });
  });

  test('sending invite shows it in pending invites list', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/admin`);

    await page.getByTestId('invite-email-input').fill('newmember@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();

    await expect(page.getByTestId('pending-invite-row')).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('pending-invite-row').getByText('newmember@example.com')).toBeVisible();
    await expect(page.getByTestId('cancel-invite-btn')).toBeVisible();
  });

  test('cancelling invite removes it from the list', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/admin`);

    await page.getByTestId('invite-email-input').fill('cancelme@example.com');
    await page.getByRole('button', { name: 'Send invite' }).click();
    await expect(page.getByTestId('pending-invite-row')).toBeVisible({ timeout: 5000 });

    await page.getByTestId('cancel-invite-btn').click();
    await expect(page.getByTestId('pending-invite-row')).not.toBeVisible({ timeout: 3000 });
  });

  test('accept invite page shows error for invalid token', async ({ page }) => {
    await page.goto('/accept-invite?token=invalid-token-xyz');
    await expect(page.getByText('invalid or has expired')).toBeVisible({ timeout: 5000 });
  });

  test('accept invite page shows error with no token', async ({ page }) => {
    await page.goto('/accept-invite');
    await expect(page.getByText('invalid')).toBeVisible({ timeout: 5000 });
  });
});
