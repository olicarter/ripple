import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal, createVote } from '../helpers';

test.describe('public results page', () => {
  test('private org results page returns 403', async ({ page, asAlice }) => {
    // org is private by default
    const res = await page.request.get(`${API}/api/orgs/${ORG_SLUG}/results`);
    expect(res.status()).toBe(403);
  });

  test('public org results page is accessible without auth', async ({ request, asAlice, org }) => {
    // Make org public via Alice's session (page.request)
    await request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { is_public: true } });
    // Use standalone request (no session cookie)
    const res = await request.get(`${API}/api/orgs/${ORG_SLUG}/results`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.org.slug).toBe(ORG_SLUG);
    expect(Array.isArray(body.proposals)).toBe(true);
  });

  test('public results page shows closed proposals with pass/fail badge', async ({ page, asAlice, org }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { is_public: true } });

    const topic = await createTopic(page.request, 'Results Topic');
    const proposal = await createProposal(page.request, topic.id, 'Passed proposal', { threshold: 50 });
    await createVote(page.request, proposal.id, asAlice.id, 'yes');
    // Close via API
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    // Navigate to public results page (no login needed)
    await page.goto(`${API}/orgs/${ORG_SLUG}/results`);
    await expect(page.getByText('Passed proposal')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('result-badge').filter({ hasText: 'Passed' })).toBeVisible();
  });

  test('public results page shows withdrawn proposals', async ({ page, asAlice, org }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { is_public: true } });

    const topic = await createTopic(page.request, 'Withdrawn Topic');
    const proposal = await createProposal(page.request, topic.id, 'Withdrawn proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/withdraw`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/results`);
    await expect(page.getByText('Withdrawn proposal')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('result-badge').filter({ hasText: 'Withdrawn' })).toBeVisible();
  });

  test('open proposals are not shown on results page', async ({ page, asAlice, org }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { is_public: true } });

    const topic = await createTopic(page.request, 'Open Topic');
    await createProposal(page.request, topic.id, 'Still open proposal');

    await page.goto(`${API}/orgs/${ORG_SLUG}/results`);
    // Wait for page to load
    await expect(page.getByText(org.name)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Still open proposal')).not.toBeVisible();
  });

  test('private org shows 403 error on results page UI', async ({ page, asAlice }) => {
    // org is private by default
    await page.goto(`${API}/orgs/${ORG_SLUG}/results`);
    await expect(page.getByText(/403|private|not have a public/i)).toBeVisible({ timeout: 10000 });
  });
});
