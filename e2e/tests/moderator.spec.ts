import { test, expect, API, ORG_SLUG } from '../fixtures';

const STORAGE_KEY = 'ripple_user';

async function switchToModerator(page: any, mod: { id: string; name: string; email: string; created_at: string }) {
  await page.request.post(`${API}/api/auth/test-setup`, { data: { name: mod.name, email: mod.email } });
  await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${mod.id}`, { data: { role: 'moderator' } });
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: JSON.stringify(mod) },
  );
}

test.describe('moderator tools', () => {
  test('moderator can edit any open proposal', async ({ page, asAlice, bob, org }) => {
    // Alice creates a proposal
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000301', organisation_id: org.id, name: 'Mod Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: { id: '00000000-0000-0000-0000-000000000302', organisation_id: org.id, topic_id: topic.item.id, title: 'Original title', status: 'open' },
    });
    const prop = await propRes.json();

    // Switch to Bob as moderator
    await switchToModerator(page, bob);
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);

    await expect(page.getByRole('button', { name: 'Edit', exact: true }).first()).toBeVisible();
  });

  test('moderator can close any open proposal', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000303', organisation_id: org.id, name: 'Close Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: { id: '00000000-0000-0000-0000-000000000304', organisation_id: org.id, topic_id: topic.item.id, title: 'Close me', status: 'open' },
    });
    const prop = await propRes.json();

    await switchToModerator(page, bob);
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);

    await expect(page.getByRole('button', { name: 'Close voting' })).toBeVisible();
    await page.getByRole('button', { name: 'Close voting' }).click();
    await page.getByRole('button', { name: 'Yes, close' }).click();
    await expect(page.getByText('Voting closed')).toBeVisible();
  });

  test('API rejects proposal edit by plain member on another member\'s proposal', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000305', organisation_id: org.id, name: 'Member Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: { id: '00000000-0000-0000-0000-000000000306', organisation_id: org.id, topic_id: topic.item.id, title: 'Original', status: 'open' },
    });
    const prop = await propRes.json();

    // Switch to Bob as plain member
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });

    const res = await page.request.patch(`${API}/api/proposals/${prop.item.id}`, {
      data: { title: 'Hijacked title' },
    });
    expect(res.status()).toBe(403);
  });

  test('API allows proposal edit by moderator on another member\'s proposal', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000307', organisation_id: org.id, name: 'Edit Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: { id: '00000000-0000-0000-0000-000000000308', organisation_id: org.id, topic_id: topic.item.id, title: 'Original', status: 'open' },
    });
    const prop = await propRes.json();

    // Switch page session to Bob as moderator
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'moderator' } });

    const res = await page.request.patch(`${API}/api/proposals/${prop.item.id}`, {
      data: { title: 'Moderator edit' },
    });
    expect(res.status()).toBe(200);
  });

  test('moderator can delete any comment', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000309', organisation_id: org.id, name: 'Comment Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: { id: '00000000-0000-0000-0000-000000000310', organisation_id: org.id, topic_id: topic.item.id, title: 'Comment proposal', status: 'open' },
    });
    const prop = await propRes.json();

    // Alice posts a comment (page session is Alice)
    const commentRes = await page.request.post(`${API}/api/proposals/${prop.item.id}/comments`, {
      data: { id: '00000000-0000-0000-0000-000000000311', body: 'Alice\'s comment' },
    });
    const comment = await commentRes.json();

    // Switch to Bob as moderator
    await switchToModerator(page, bob);
    await page.goto(`https://localhost:5174/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);

    // Moderator should see Delete button on Alice's comment
    await expect(page.getByRole('button', { name: 'Delete' }).first()).toBeVisible();
  });

  test('API rejects comment delete by plain member on another member\'s comment', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000312', organisation_id: org.id, name: 'Del Comment Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: { id: '00000000-0000-0000-0000-000000000313', organisation_id: org.id, topic_id: topic.item.id, title: 'Del comment proposal', status: 'open' },
    });
    const prop = await propRes.json();

    const commentRes = await page.request.post(`${API}/api/proposals/${prop.item.id}/comments`, {
      data: { id: '00000000-0000-0000-0000-000000000314', body: 'Alice comment' },
    });
    const comment = await commentRes.json();

    // Bob as member tries to delete
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });

    const res = await page.request.delete(`${API}/api/comments/${comment.item.id}`);
    expect(res.status()).toBe(403);
  });

  test('API allows topic update by moderator', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000315', organisation_id: org.id, name: 'Editable Topic' },
    });
    const topic = await topicRes.json();

    // Switch to Bob as moderator
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'moderator' } });

    const res = await page.request.patch(`${API}/api/topics/${topic.item.id}`, {
      data: { name: 'Updated by moderator' },
    });
    expect(res.status()).toBe(200);
  });

  test('API rejects topic update by plain member', async ({ page, asAlice, bob, org }) => {
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000316', organisation_id: org.id, name: 'Protected Topic' },
    });
    const topic = await topicRes.json();

    // Bob as member
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });

    const res = await page.request.patch(`${API}/api/topics/${topic.item.id}`, {
      data: { name: 'Hijacked' },
    });
    expect(res.status()).toBe(403);
  });
});
