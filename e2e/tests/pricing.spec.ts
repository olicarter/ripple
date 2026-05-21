import { test, expect, ORG_SLUG } from '../fixtures';

test.describe('pricing page', () => {
  test('shows both tiers with correct prices', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('heading', { name: 'Simple, transparent pricing' })).toBeVisible();
    await expect(page.getByText('$0')).toBeVisible();
    await expect(page.getByText('$29')).toBeVisible();
  });

  test('shows free plan features', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText('Up to 15 members')).toBeVisible();
    await expect(page.getByText('Unlimited proposals & votes')).toBeVisible();
  });

  test('shows pro plan features', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByText('Unlimited members')).toBeVisible();
    await expect(page.getByText('Slack integration')).toBeVisible();
  });

  test('logged-out user sees "Get started free" and "Start free trial"', async ({ page }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('button', { name: 'Get started free' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start free trial' })).toBeVisible();
  });

  test('"Get started free" navigates to landing page', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Get started free' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /Democratic decisions/ })).toBeVisible();
  });

  test('"Start free trial" navigates to landing page', async ({ page }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Start free trial' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: /Democratic decisions/ })).toBeVisible();
  });

  test('logged-in user sees "Go to dashboard" and "Upgrade your org"', async ({ page, asAlice }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('button', { name: 'Go to dashboard' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade your org' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Get started free' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Start free trial' })).not.toBeVisible();
  });

  test('"Go to dashboard" navigates logged-in user home', async ({ page, asAlice }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Go to dashboard' }).click();
    // OrgListPage auto-redirects to the single org when the user has exactly one
    await expect(page).toHaveURL(/\/orgs\//);
  });

  test('"Upgrade your org" navigates logged-in user to home', async ({ page, asAlice }) => {
    await page.goto('/pricing');
    await page.getByRole('button', { name: 'Upgrade your org' }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('upgrade to pro', () => {
  function mockBillingStatus(page: any, plan: 'free' | 'pro', canUpgrade = true) {
    return page.route('**/api/billing/*/status', (route: any) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          plan,
          memberCount: 1,
          memberLimit: plan === 'free' ? 15 : null,
          canUpgrade: plan === 'free' && canUpgrade,
        }),
      }),
    );
  }

  test('admin sees Plan & billing section', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'free');
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
  });

  test('free plan shows current member count and limit', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'free');
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByText(/1 \/ 15 members/)).toBeVisible();
  });

  test('free plan shows Upgrade to Pro button', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'free');
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).toBeVisible();
  });

  test('clicking Upgrade to Pro calls checkout API', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'free');
    await page.route('**/api/billing/*/checkout', (route: any) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://checkout.stripe.com/pay/test-session' }),
      }),
    );
    await page.route('https://checkout.stripe.com/**', (route: any) => route.abort());

    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    const checkoutRequest = page.waitForRequest(
      (req: any) => req.url().includes('/billing/') && req.url().includes('/checkout') && req.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Upgrade to Pro' }).click();
    await checkoutRequest;
  });

  test('pro plan shows Manage billing button, not Upgrade', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'pro');
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByRole('button', { name: 'Manage billing' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upgrade to Pro' })).not.toBeVisible();
  });

  test('clicking Manage billing calls portal API', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'pro');
    await page.route('**/api/billing/*/portal', (route: any) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ url: 'https://billing.stripe.com/session/test' }),
      }),
    );
    await page.route('https://billing.stripe.com/**', (route: any) => route.abort());

    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    const portalRequest = page.waitForRequest(
      (req: any) => req.url().includes('/billing/') && req.url().includes('/portal') && req.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Manage billing' }).click();
    await portalRequest;
  });

  test('admin billing section links to pricing page', async ({ page, asAlice }) => {
    await mockBillingStatus(page, 'free');
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByRole('link', { name: 'View pricing' })).toBeVisible();
    await page.getByRole('link', { name: 'View pricing' }).click();
    await expect(page).toHaveURL('/pricing');
  });
});
