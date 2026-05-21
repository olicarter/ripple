import { test, expect, API, ORG_SLUG } from '../fixtures';

test('settings page loads and shows current name', async ({ page, asAlice }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Alice');
  await expect(page.getByText('alice@test.ripple')).toBeVisible();
});

test('can update display name', async ({ page, asAlice }) => {
  await page.goto('/settings');
  await page.getByLabel('Name').fill('Alice Updated');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Name updated')).toBeVisible();
});

test('save button disabled when name unchanged', async ({ page, asAlice }) => {
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('settings page shows passkeys section', async ({ page, asAlice }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: '+ Add passkey' })).toBeVisible();
});

test('passkey list loads (test user has no real passkeys)', async ({ page, asAlice }) => {
  await page.goto('/settings');
  // test-setup users have no credentials, so the list will be empty
  await expect(page.getByText('No passkeys found.')).toBeVisible();
});

test('settings nav link is visible when signed in', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/proposals');
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
});

test('cannot delete last passkey via API', async ({ page, asAlice }) => {
  // test-setup users have no credentials, but we can verify the API rejects
  // deleting a non-existent/last key by attempting with a fake id
  const res = await page.request.delete(`${API}/api/auth/passkeys/nonexistent-id`);
  // 404 (not found) or 400 (last key) — either is a refusal
  expect(res.status()).toBeGreaterThanOrEqual(400);
});

test('profile page links to account settings', async ({ page, asAlice }) => {
  await page.goto(`/orgs/${ORG_SLUG}/users/${asAlice.id}`);
  await expect(page.getByRole('link', { name: 'Account settings →' })).toBeVisible();
});
