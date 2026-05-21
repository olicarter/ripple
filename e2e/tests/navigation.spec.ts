import { test, expect } from '../fixtures';

test('/ shows organisations list', async ({ page, asAlice }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Organisations' })).toBeVisible();
});

test('proposals nav link is active on /proposals', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/proposals');
  const link = page.getByRole('link', { name: 'Proposals' });
  await expect(link).toHaveCSS('font-weight', '500');
});

test('delegations nav link navigates to /delegations', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('link', { name: 'Delegations' }).click();
  await expect(page).toHaveURL('/orgs/ripple-test/delegations');
});

test('delegations nav link is active on /delegations', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/delegations');
  const link = page.getByRole('link', { name: 'Delegations' });
  await expect(link).toHaveCSS('font-weight', '500');
});

test('proposals nav link is not active on /delegations', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/delegations');
  const link = page.getByRole('link', { name: 'Proposals' });
  await expect(link).not.toHaveCSS('font-weight', '500');
});
