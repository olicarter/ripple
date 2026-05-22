import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal } from '../helpers';

test.describe('proposal outcome tracking', () => {
  test('admin sees outcome selector on closed proposal', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Outcome Topic');
    const proposal = await createProposal(page.request, topic.id, 'Outcome proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByTestId('outcome-select')).toBeVisible({ timeout: 10000 });
  });

  test('admin can set outcome to implemented', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Impl Topic');
    const proposal = await createProposal(page.request, topic.id, 'Impl proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByTestId('outcome-select').selectOption('implemented');

    await expect(page.getByText('Outcome saved')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('outcome-badge')).toContainText('Implemented');
  });

  test('admin can set outcome to in_progress', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'WIP Topic');
    const proposal = await createProposal(page.request, topic.id, 'WIP proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByTestId('outcome-select').selectOption('in_progress');

    await expect(page.getByText('Outcome saved')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('outcome-badge')).toContainText('In progress');
  });

  test('outcome badge appears on closed proposal with outcome set', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Badge Topic');
    const proposal = await createProposal(page.request, topic.id, 'Badge proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);
    await page.request.post(`${API}/api/proposals/${proposal.id}/outcome`, {
      data: { outcome: 'not_implemented' },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByTestId('outcome-badge')).toContainText('Not implemented', { timeout: 10000 });
  });

  test('API rejects outcome on open proposal', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Open Outcome Topic');
    const proposal = await createProposal(page.request, topic.id, 'Open outcome proposal');

    const res = await page.request.post(`${API}/api/proposals/${proposal.id}/outcome`, {
      data: { outcome: 'implemented' },
    });
    expect(res.status()).toBe(400);
  });

  test('member cannot set outcome', async ({ page, asAlice, bob }) => {
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });

    const topic = await createTopic(page.request, 'Member Outcome Topic');
    const proposal = await createProposal(page.request, topic.id, 'Member outcome proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    // Bob's session is now active
    const res = await page.request.post(`${API}/api/proposals/${proposal.id}/outcome`, {
      data: { outcome: 'implemented' },
    });
    expect(res.status()).toBe(403);
  });
});
