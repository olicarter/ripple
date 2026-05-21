import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, TEST_ORG_ID } from '../helpers';

test.describe('anonymous voting', () => {
  async function createAnonProposal(page: Parameters<Parameters<typeof test>[1]>[0]) {
    const topic = await createTopic(page.request, 'Anonymous Voting Topic');
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: crypto.randomUUID(),
        organisation_id: TEST_ORG_ID,
        topic_id: topic.id,
        title: 'Anonymous voting test',
        status: 'open',
        anonymous_voting: true,
      },
    });
    const { item: proposal } = await propRes.json();
    return { proposal };
  }

  test('votes list returns null user_id for anonymous proposal', async ({ page, asAlice }) => {
    const { proposal } = await createAnonProposal(page);

    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });

    const votes = await page.request.get(`${API}/api/votes/proposal/${proposal.id}`).then(r => r.json());
    expect(votes).toHaveLength(1);
    expect(votes[0].user_id).toBeNull();
  });

  test('tally still counts correctly for anonymous proposal', async ({ page, asAlice }) => {
    const { proposal } = await createAnonProposal(page);

    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });

    const tally = await page.request.get(`${API}/api/proposals/${proposal.id}/tally`).then(r => r.json());
    expect(tally.yes).toBe(1);
    expect(tally.total).toBe(1);
  });

  test('UI shows Anonymous voting badge on proposal detail', async ({ page, asAlice }) => {
    const { proposal } = await createAnonProposal(page);

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Anonymous voting').first()).toBeVisible({ timeout: 10000 });
  });

  test('UI shows Anonymous member for vote statements on anonymous proposals', async ({ page, asAlice }) => {
    const { proposal } = await createAnonProposal(page);

    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes', reason: 'Good idea' },
    });

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Anonymous member')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Good idea').first()).toBeVisible();
  });
});
