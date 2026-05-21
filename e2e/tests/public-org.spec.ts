import { test, expect, API, ORG_SLUG } from '../fixtures';

test.describe('public organisation', () => {
  test('admin can toggle public org setting', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/admin`);
    const checkbox = page.getByLabel('Allow anyone to discover and join this organisation');
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(page.getByText('Setting saved').first()).toBeVisible();
    await checkbox.uncheck();
    await expect(page.getByText('Setting saved').first()).toBeVisible();
  });

  test('authenticated non-member sees public org in Discover and can join', async ({ page, asAlice, bob }) => {
    // Create a second public org as Alice
    const orgRes = await page.request.post(`${API}/api/orgs`, {
      data: { name: 'Open Community', slug: 'open-community-test' },
    });
    const { item: newOrg } = await orgRes.json();
    await page.request.patch(`${API}/api/orgs/${newOrg.slug}`, { data: { is_public: true } });

    // Switch page to Bob's session, then remove him from ripple-test so he has 0 orgs
    // (avoids the single-org redirect that would take him away from the OrgListPage)
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.delete(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`);
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: 'ripple_user', value: JSON.stringify(bob) },
    );

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Discover' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Open Community')).toBeVisible();

    await page.getByTestId('discover-section').getByRole('button', { name: 'Join' }).click();
    await expect(page).toHaveURL(/open-community-test/, { timeout: 8000 });
  });

  test('API: authenticated user can join a public org', async ({ page, asAlice }) => {
    const orgRes = await page.request.post(`${API}/api/orgs`, {
      data: { name: 'Joinable Org', slug: 'joinable-org-api-test' },
    });
    const { item: newOrg } = await orgRes.json();
    await page.request.patch(`${API}/api/orgs/${newOrg.slug}`, { data: { is_public: true } });

    const joinRes = await page.request.post(`${API}/api/orgs/${newOrg.slug}/join`, { data: {} });
    expect(joinRes.status()).toBe(201);
    const body = await joinRes.json();
    expect(body.item.organisation_id).toBe(newOrg.id);
  });

  test('API: joining a private org without a token is rejected', async ({ page, asAlice }) => {
    const res = await page.request.post(`${API}/api/orgs/${ORG_SLUG}/join`, { data: {} });
    expect(res.status()).toBe(403);
  });

  test('unauthenticated user can browse a public org without signing in', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { is_public: true } });

    // Navigate without any session or localStorage
    await page.context().clearCookies();
    await page.addInitScript(({ key }) => localStorage.removeItem(key), { key: 'ripple_user' });

    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    // Shell renders with a Sign in button — not the full AuthPanel
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).not.toBeVisible();
  });

  test('unauthenticated user sees sign-in form for private org', async ({ page }) => {
    // ripple-test is private by default; no session set
    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible({ timeout: 10000 });
  });
});
