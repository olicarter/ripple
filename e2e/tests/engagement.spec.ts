import { test, expect, API, ORG_SLUG } from '../fixtures';

test.describe('member engagement score', () => {
  test('shows participation percentage on members page', async ({ page, asAlice, org }) => {
    // Create a topic and open proposal
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000501', organisation_id: org.id, name: 'Engagement Topic' },
    });
    const topic = await topicRes.json();

    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000502',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Engagement test proposal',
        status: 'open',
      },
    });
    const prop = await propRes.json();

    // Alice votes
    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000503', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/members`);
    // Alice voted on 1/1 proposals → 100%
    await expect(page.getByText(/100% participation/)).toBeVisible({ timeout: 8000 });
  });

  test('shows 0% participation when member has not voted', async ({ page, asAlice, bob, org }) => {
    // Add Bob as member (he's already added by fixture as admin, just downgrade)
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000504', organisation_id: org.id, name: 'Engagement Topic 2' },
    });
    const topic = await topicRes.json();

    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000505',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Another proposal',
        status: 'open',
      },
    });
    const prop = await propRes.json();

    // Only Alice votes, Bob doesn't
    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000506', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/members`);
    // Wait for Alice's row to confirm Electric has synced votes+proposals
    await expect(page.getByText(/100% participation/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/0% participation/).first()).toBeVisible();
  });
});
