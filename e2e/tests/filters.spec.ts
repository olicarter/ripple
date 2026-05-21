import { test, expect, API } from '../fixtures';
import { createTopic, createProposal } from '../helpers';

// ── Topic filter ──────────────────────────────────────────────────────────────

test('topic filter shows only proposals in that topic', async ({ page, asAlice }) => {
  const env = await createTopic(page.request, 'Environment');
  const pol = await createTopic(page.request, 'Policy');
  await createProposal(page.request, env.id, 'Solar panels');
  await createProposal(page.request, pol.id, 'New tax');

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Environment' }).click();

  await expect(page.getByText('Solar panels')).toBeVisible();
  await expect(page.getByText('New tax')).not.toBeVisible();
});

test('clicking "All topics" restores full list', async ({ page, asAlice }) => {
  const env = await createTopic(page.request, 'Environment');
  const pol = await createTopic(page.request, 'Policy');
  await createProposal(page.request, env.id, 'Solar panels');
  await createProposal(page.request, pol.id, 'New tax');

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Environment' }).click();
  await expect(page.getByText('New tax')).not.toBeVisible();

  await page.getByRole('button', { name: 'All topics' }).click();
  await expect(page.getByText('New tax')).toBeVisible();
  await expect(page.getByText('Solar panels')).toBeVisible();
});

// ── Status filter ─────────────────────────────────────────────────────────────

test('Open filter shows only open proposals', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  await createProposal(page.request, topic.id, 'Still open');
  await createProposal(page.request, topic.id, 'Already closed', { status: 'closed' });

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Open' }).click();

  await expect(page.getByText('Still open')).toBeVisible();
  await expect(page.getByText('Already closed')).not.toBeVisible();
});

test('Closed filter shows only closed proposals', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  await createProposal(page.request, topic.id, 'Still open');
  await createProposal(page.request, topic.id, 'Already closed', { status: 'closed' });

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Closed' }).click();

  await expect(page.getByText('Already closed')).toBeVisible();
  await expect(page.getByText('Still open')).not.toBeVisible();
});

test('Withdrawn filter shows only withdrawn proposals', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  await createProposal(page.request, topic.id, 'Still open');
  const withdrawn = await createProposal(page.request, topic.id, 'Pulled proposal');
  await page.request.post(`${API}/api/proposals/${withdrawn.id}/withdraw`);

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Withdrawn' }).click();

  await expect(page.getByText('Pulled proposal')).toBeVisible();
  await expect(page.getByText('Still open')).not.toBeVisible();
});

test('"All statuses" restores full list', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  await createProposal(page.request, topic.id, 'Open one');
  await createProposal(page.request, topic.id, 'Closed one', { status: 'closed' });

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Open' }).click();
  await expect(page.getByText('Closed one')).not.toBeVisible();

  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByText('Open one')).toBeVisible();
  await expect(page.getByText('Closed one')).toBeVisible();
});

// ── Validation: user display name ────────────────────────────────────────────

test('API rejects empty display name', async ({ page, asAlice }) => {
  const res = await page.request.patch(`${API}/api/users/${asAlice.id}`, {
    data: { name: '' },
  });
  expect(res.status()).toBe(400);
});

test('API rejects display name exceeding 100 chars', async ({ page, asAlice }) => {
  const res = await page.request.patch(`${API}/api/users/${asAlice.id}`, {
    data: { name: 'A'.repeat(101) },
  });
  expect(res.status()).toBe(400);
  const body = await res.json();
  expect(body.message).toMatch(/100/);
});
