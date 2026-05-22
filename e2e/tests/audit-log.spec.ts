import { test, expect, API, ORG_SLUG } from '../fixtures';

test.describe('audit log', () => {
  test('admin sees audit log section on admin page', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByText('Recent activity')).toBeVisible();
  });

  test('audit log records proposal created', async ({ page, asAlice, org }) => {
    // Create a topic and a proposal
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000301', organisation_id: org.id, name: 'Audit Topic' },
    });
    const topic = await topicRes.json();
    await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000302',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Audited proposal',
        status: 'open',
      },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByTestId('audit-action').filter({ hasText: 'proposal.created' })).toBeVisible();
  });

  test('audit log records org settings changed', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, {
      data: { description: 'Updated via test' },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByTestId('audit-action').filter({ hasText: 'org.settings_changed' })).toBeVisible();
  });

  test('audit log shows actor name', async ({ page, asAlice }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, {
      data: { description: 'Named actor test' },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    // Alice should appear as the actor
    await expect(page.getByText('Alice')).toBeVisible();
  });

  test('non-admin cannot access audit log endpoint', async ({ page, asAlice, bob }) => {
    // Add Bob as a member
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    // Bob's page session is now active
    const res = await page.request.get(`${API}/api/orgs/${ORG_SLUG}/audit-log`);
    expect(res.status()).toBe(403);
  });
});
