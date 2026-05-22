import { test, expect, API, ORG_SLUG } from '../fixtures';

test.describe('default quorum', () => {
  test('tally shows quorum participation when quorum is set on proposal', async ({ page, asAlice, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000401', organisation_id: org.id, name: 'Quorum Topic' },
    });
    const topic = await topicRes.json();

    // Create proposal with 50% quorum. org has 2 members (Alice + _OrgFixture from org fixture).
    // Alice votes → 1/2 = 50% ≥ 50% → quorate.
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000402',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Quorum test proposal',
        status: 'open',
        quorum: 50,
      },
    });
    const prop = await propRes.json();

    // Alice votes yes
    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000403', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });

    const tallyRes = await page.request.get(`${API}/api/proposals/${prop.item.id}/tally`);
    const tally = await tallyRes.json();

    expect(tally.eligible_count).toBeGreaterThan(0);
    expect(tally.quorum_met).toBe(true);
  });

  test('tally shows quorum not met when participation below threshold', async ({ page, asAlice, bob, org }) => {
    // Add Bob as member so there are 2 eligible members
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    // Restore Alice's session
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000404', organisation_id: org.id, name: 'Low Quorum Topic' },
    });
    const topic = await topicRes.json();

    // With Bob added there are now 3 members (Alice, _OrgFixture, Bob).
    // Alice alone votes → 1/3 = 33% < 75% → not quorate.
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000405',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Unquorate proposal',
        status: 'open',
        quorum: 75,
      },
    });
    const prop = await propRes.json();

    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000406', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });

    const tallyRes = await page.request.get(`${API}/api/proposals/${prop.item.id}/tally`);
    const tally = await tallyRes.json();

    expect(tally.eligible_count).toBeGreaterThan(1);
    expect(tally.quorum_met).toBe(false);
  });

  test('tally returns null quorum fields when no quorum set on proposal', async ({ page, asAlice, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000407', organisation_id: org.id, name: 'No Quorum Topic' },
    });
    const topic = await topicRes.json();

    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000408',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'No quorum proposal',
        status: 'open',
      },
    });
    const prop = await propRes.json();

    const tallyRes = await page.request.get(`${API}/api/proposals/${prop.item.id}/tally`);
    const tally = await tallyRes.json();

    expect(tally.eligible_count).toBeNull();
    expect(tally.quorum_met).toBeNull();
  });

  test('admin can set default quorum on org', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await page.fill('#admin-quorum', '60');
    await page.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByText('Defaults saved')).toBeVisible();
  });

  test('closed proposal shows not quorate banner when quorum not met', async ({ page, asAlice, bob, org }) => {
    // Add Bob so there are 2 members
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000409', organisation_id: org.id, name: 'Banner Topic' },
    });
    const topic = await topicRes.json();

    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000410',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Not quorate proposal',
        status: 'open',
        quorum: 75,
      },
    });
    const prop = await propRes.json();

    // Only Alice votes → 1 of 3 (33%) < 75% quorum → not quorate
    await page.request.post(`${API}/api/votes`, {
      data: { id: '00000000-0000-0000-0000-000000000411', proposal_id: prop.item.id, user_id: asAlice.id, choice: 'yes' },
    });

    // Close the proposal
    await page.request.post(`${API}/api/proposals/${prop.item.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    // Wait for Electric to sync the closed status, then tally loads
    await expect(page.getByText('closed', { exact: true })).toBeVisible();
    await expect(page.getByText('Not quorate', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/non-binding/)).toBeVisible();
  });
});
