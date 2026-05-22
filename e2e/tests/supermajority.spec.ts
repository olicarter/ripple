import { test, expect, API, ORG_SLUG } from '../fixtures';

async function createTopicAndProposal(
  page: any,
  org: { id: string },
  topicId: string,
  propId: string,
  title: string,
  threshold: number,
) {
  const topicRes = await page.request.post(`${API}/api/topics`, {
    data: { id: topicId, organisation_id: org.id, name: `Topic ${topicId.slice(-4)}` },
  });
  const topic = await topicRes.json();
  const propRes = await page.request.post(`${API}/api/proposals`, {
    data: { id: propId, organisation_id: org.id, topic_id: topic.item.id, title, status: 'open', threshold },
  });
  return (await propRes.json()).item;
}

test.describe('supermajority threshold', () => {
  test('proposal with 67% threshold fails when only 50% yes', async ({ page, asAlice, bob, org }) => {
    // 2 voters: Alice (yes) + Bob (no) → 50% yes < 67% threshold → failed
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const prop = await createTopicAndProposal(
      page, org,
      '00000000-0000-0000-0000-000000000701',
      '00000000-0000-0000-0000-000000000702',
      'Two-thirds test — should fail',
      67,
    );

    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000703', proposal_id: prop.id, user_id: asAlice.id, choice: 'yes' },
    });
    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000704', proposal_id: prop.id, user_id: bob.id, choice: 'no' },
    });
    await page.request.post(`${API}/api/proposals/${prop.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.id}`);
    await expect(page.getByText('Proposal failed', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/67% required to pass/)).toBeVisible();
  });

  test('proposal with 67% threshold passes when 100% yes', async ({ page, asAlice, org }) => {
    const prop = await createTopicAndProposal(
      page, org,
      '00000000-0000-0000-0000-000000000705',
      '00000000-0000-0000-0000-000000000706',
      'Two-thirds test — should pass',
      67,
    );

    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000707', proposal_id: prop.id, user_id: asAlice.id, choice: 'yes' },
    });
    await page.request.post(`${API}/api/proposals/${prop.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.id}`);
    await expect(page.getByText('Proposal passed', { exact: true })).toBeVisible({ timeout: 10000 });
  });

  test('create form shows threshold preset buttons', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals`);
    await page.getByRole('button', { name: '+ New proposal' }).click();
    await expect(page.getByRole('button', { name: /Simple majority/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Two-thirds/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Three-quarters/ })).toBeVisible();
    await expect(page.getByLabel('Passing threshold')).toBeVisible();
  });

  test('threshold input is always visible and preset buttons update it', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals`);
    await page.getByRole('button', { name: '+ New proposal' }).click();
    await expect(page.getByLabel('Passing threshold')).toBeVisible();
    await page.getByRole('button', { name: /Two-thirds/ }).click();
    await expect(page.getByLabel('Passing threshold')).toHaveValue('67');
  });
});
