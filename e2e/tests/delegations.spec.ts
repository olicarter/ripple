import { test, expect } from '../fixtures';
import { createTopic, createDelegation } from '../helpers';

test('shows sign-in panel when logged out', async ({ page }) => {
  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});

test('shows empty outgoing delegations state', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByText('No delegations set')).toBeVisible();
});

test('shows empty incoming delegations state', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByText('Nobody has delegated to you yet')).toBeVisible();
});

test('can add a global delegation', async ({ page, asAlice, bob }) => {
  await page.goto('/orgs/ripple-test/delegations');

  await page.getByPlaceholder('Search by name or email…').fill('Bob');
  await page.getByRole('option', { name: /Bob/ }).click();

  await page.getByRole('button', { name: 'Add delegation' }).click();

  await expect(page.getByText('Bob').first()).toBeVisible();
  await expect(page.getByText('Global', { exact: true })).toBeVisible();
});

test('can add a topic-scoped delegation', async ({ page, asAlice, bob }) => {
  const topic = await createTopic(page.request, 'Environment');

  await page.goto('/orgs/ripple-test/delegations');

  await page.getByPlaceholder('Search by name or email…').fill('Bob');
  await page.getByRole('option', { name: /Bob/ }).click();

  await page.getByLabel('Scope').selectOption({ label: 'Environment' });
  await page.getByRole('button', { name: 'Add delegation' }).click();

  await expect(page.getByText('Bob').first()).toBeVisible();
  await expect(page.getByText('Environment').first()).toBeVisible();
});

test('add delegation button is disabled when no delegate selected', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByRole('button', { name: 'Add delegation' })).toBeDisabled();
});

test('shows error on duplicate scope', async ({ page, asAlice, bob }) => {
  // Add first global delegation via API
  await createDelegation(page.request, asAlice.id, bob.id, null);

  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByText('Global', { exact: true })).toBeVisible();

  // Open the add delegation form (hidden when delegations already exist)
  await page.getByRole('button', { name: '+ Add delegation' }).click();

  // Try to add another global delegation
  await page.getByPlaceholder('Search by name or email…').fill('Bob');
  await page.getByRole('option', { name: /Bob/ }).click();

  await page.getByRole('button', { name: 'Add delegation' }).click();
  await expect(page.getByText('You already have a delegation to this person for that scope.')).toBeVisible();
});

test('can remove a delegation', async ({ page, asAlice, bob }) => {
  await createDelegation(page.request, asAlice.id, bob.id, null);

  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByText('Global', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Yes, remove' }).click();
  await expect(page.getByText('No delegations set')).toBeVisible();
});

test('shows incoming delegations', async ({ page, asAlice, bob, request }) => {
  // Bob delegates to Alice — using Bob's session (standalone `request` fixture)
  await createDelegation(request, bob.id, asAlice.id, null);

  await page.goto('/orgs/ripple-test/delegations');
  await expect(page.getByText('Bob').first()).toBeVisible();
});

test('user search filters by name', async ({ page, asAlice, bob }) => {
  await page.goto('/orgs/ripple-test/delegations');

  await page.getByPlaceholder('Search by name or email…').fill('Bo');
  await expect(page.getByRole('option', { name: /Bob/ })).toBeVisible();
  // Alice's email won't appear in results (she doesn't match 'Bo')
  await expect(page.getByText('alice@test.ripple')).not.toBeVisible();
});

test('user search filters by email', async ({ page, asAlice, bob }) => {
  await page.goto('/orgs/ripple-test/delegations');

  await page.getByPlaceholder('Search by name or email…').fill('bob@test');
  await expect(page.getByRole('option', { name: /Bob/ })).toBeVisible();
});

test('user search excludes self', async ({ page, asAlice, bob }) => {
  await page.goto('/orgs/ripple-test/delegations');

  await page.getByPlaceholder('Search by name or email…').fill('alice@test');
  // Alice's email won't appear in search results since she's excluded
  await expect(page.getByText('alice@test.ripple')).not.toBeVisible();
});
