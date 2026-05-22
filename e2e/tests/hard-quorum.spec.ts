import { test, expect, API, ORG_SLUG } from '../fixtures';

test.describe('hard quorum', () => {
  test('hard quorum not met makes result "failed" in tally', async ({ page, asAlice, bob, org }) => {
    // 3 members: Alice, Bob, _OrgFixture. Bob doesn't vote → 1/3 = 33% < 75% quorum
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000601', organisation_id: org.id, name: 'Hard Quorum Topic' },
    });
    const topic = await topicRes.json();

    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000602',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Hard quorum proposal',
        status: 'open',
        quorum: 75,
        quorum_type: 'hard',
      },
    });
    const prop = await propRes.json();

    // Alice votes yes
    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000603', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });

    // Close the proposal
    await page.request.post(`${API}/api/proposals/${prop.item.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    await expect(page.getByText('closed', { exact: true })).toBeVisible();
    // Hard quorum not met → result banner says "Failed"
    await expect(page.getByText('Failed — quorum not met', { exact: true })).toBeVisible({ timeout: 10000 });
    // Should show as "Failed" badge, not "Passed"
    await expect(page.getByRole('heading', { name: /hard quorum proposal/i })).toBeVisible();
  });

  test('soft quorum not met shows non-binding result (not failed)', async ({ page, asAlice, bob, org }) => {
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000604', organisation_id: org.id, name: 'Soft Quorum Topic' },
    });
    const topic = await topicRes.json();

    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000605',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Soft quorum proposal',
        status: 'open',
        quorum: 75,
        quorum_type: 'soft',
      },
    });
    const prop = await propRes.json();

    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000606', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });
    await page.request.post(`${API}/api/proposals/${prop.item.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    await expect(page.getByText('closed', { exact: true })).toBeVisible();
    // Soft quorum → shows "Not quorate" advisory, not hard "Failed"
    await expect(page.getByText('Not quorate', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/non-binding/)).toBeVisible();
  });

  test('hard quorum met → result shows passed/failed based on votes', async ({ page, asAlice, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000607', organisation_id: org.id, name: 'Hard Quorum Met Topic' },
    });
    const topic = await topicRes.json();

    // org has 2 members (Alice + _OrgFixture). Alice votes → 1/2 = 50% ≥ 50% quorum → met.
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000608',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Hard quorum met proposal',
        status: 'open',
        quorum: 50,
        quorum_type: 'hard',
      },
    });
    const prop = await propRes.json();

    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000609', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });
    await page.request.post(`${API}/api/proposals/${prop.item.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    await expect(page.getByText('closed', { exact: true })).toBeVisible();
    // Quorum met → normal result
    await expect(page.getByText('Proposal passed', { exact: true })).toBeVisible({ timeout: 10000 });
  });
});
