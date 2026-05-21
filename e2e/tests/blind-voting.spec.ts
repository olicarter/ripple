import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, TEST_ORG_ID } from '../helpers';

test.describe('blind voting (voting_visibility = hidden)', () => {
  async function createBlindProposal(page: Parameters<Parameters<typeof test>[1]>[0], title: string) {
    const topic = await createTopic(page.request, 'Blind Voting Topic');
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: crypto.randomUUID(),
        organisation_id: TEST_ORG_ID,
        topic_id: topic.id,
        title,
        status: 'open',
      },
    });
    const { item: proposal } = await propRes.json();
    return proposal;
  }

  test('tally returns zeros while proposal is open', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { voting_visibility: 'hidden' } });

    const proposal = await createBlindProposal(page, 'Blind voting test');

    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });

    const tally = await page.request.get(`${API}/api/proposals/${proposal.id}/tally`).then(r => r.json());
    expect(tally.yes).toBe(0);
    expect(tally.no).toBe(0);
    expect(tally.total).toBe(0);
  });

  test('votes list returns empty while proposal is open', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { voting_visibility: 'hidden' } });

    const proposal = await createBlindProposal(page, 'Blind votes list test');

    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });

    const votes = await page.request.get(`${API}/api/votes/proposal/${proposal.id}`).then(r => r.json());
    expect(votes).toHaveLength(0);
  });

  test('tally is visible after proposal closes', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { voting_visibility: 'hidden' } });

    const proposal = await createBlindProposal(page, 'Blind voting closed test');

    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });

    await page.request.patch(`${API}/api/proposals/${proposal.id}`, { data: { status: 'closed' } });

    const tally = await page.request.get(`${API}/api/proposals/${proposal.id}/tally`).then(r => r.json());
    expect(tally.yes).toBeGreaterThan(0);
  });

  test('UI hides vote counts on proposal page when visibility is hidden', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { voting_visibility: 'hidden' } });

    const proposal = await createBlindProposal(page, 'Hidden tally UI test');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Vote counts are hidden until this proposal closes')).toBeVisible({ timeout: 10000 });
  });
});
