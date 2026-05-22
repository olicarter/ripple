import { test as base } from '@playwright/test';

export const API = process.env.PLAYWRIGHT_API_BASE ?? 'https://localhost:5174';
const STORAGE_KEY = 'ripple_user';

export const ORG_SLUG = 'ripple-test';

export type TestUser = { id: string; name: string; email: string; created_at: string };
export type TestOrg = { id: string; slug: string; name: string };

export const test = base.extend<{
  resetDb: void;
  asAlice: TestUser;
  bob: TestUser;
  org: TestOrg;
}>({
  // Truncates all tables before each test for a clean slate.
  resetDb: [async ({ request }, use) => {
    await request.post(`${API}/api/auth/test-reset`);
    await use();
  }, { auto: true }],

  // Creates Alice, sets her session cookie on the page context, and injects
  // localStorage so the React app sees her as logged in on first navigation.
  asAlice: async ({ page }, use) => {
    const res = await page.request.post(`${API}/api/auth/test-setup`, {
      data: { name: 'Alice', email: 'alice@test.ripple' },
    });
    const data = (await res.json()) as TestUser & { org: TestOrg };
    const user: TestUser = { id: data.id, name: data.name, email: data.email, created_at: data.created_at };

    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      { key: STORAGE_KEY, value: JSON.stringify(user) },
    );

    await use(user);
  },

  // Creates Bob using the standalone request context.
  bob: async ({ request }, use) => {
    const res = await request.post(`${API}/api/auth/test-setup`, {
      data: { name: 'Bob', email: 'bob@test.ripple' },
    });
    const data = (await res.json()) as TestUser & { org: TestOrg };
    await use({ id: data.id, name: data.name, email: data.email, created_at: data.created_at });
  },

  // Provides the shared test org created by testSetup.
  org: async ({ request }, use) => {
    const res = await request.post(`${API}/api/auth/test-setup`, {
      data: { name: '_OrgFixture', email: 'org-fixture@test.ripple' },
    });
    const data = (await res.json()) as TestUser & { org: TestOrg };
    await use(data.org);
  },
});

export { expect } from '@playwright/test';
