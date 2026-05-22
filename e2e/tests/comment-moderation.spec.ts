import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal, createComment } from '../helpers';

test.describe('comment moderation', () => {
  test('moderator sees Hide button on comments', async ({ page, asAlice, bob }) => {
    // Promote Bob to moderator
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'moderator' } });
    // Restore Alice's session
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topic = await createTopic(page.request, 'Mod Topic');
    const proposal = await createProposal(page.request, topic.id, 'Mod proposal');
    await createComment(page.request, proposal.id, 'Visible comment');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByRole('button', { name: 'Hide' })).toBeVisible({ timeout: 10000 });
  });

  test('admin can hide a comment with a reason', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Hide Topic');
    const proposal = await createProposal(page.request, topic.id, 'Hide proposal');
    await createComment(page.request, proposal.id, 'Offensive content here');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Offensive content here')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Hide' }).click();
    await page.getByPlaceholder('Reason for hiding (required)').fill('Violates community guidelines');
    await page.getByRole('button', { name: 'Hide', exact: true }).last().click();

    await expect(page.getByText('Comment removed by moderator')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Violates community guidelines')).toBeVisible();
    await expect(page.getByText('Offensive content here')).not.toBeVisible();
    await expect(page.getByText('Comment hidden')).toBeVisible();
  });

  test('admin can unhide a hidden comment', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Unhide Topic');
    const proposal = await createProposal(page.request, topic.id, 'Unhide proposal');
    const comment = await createComment(page.request, proposal.id, 'To be unhidden');

    // Hide via API
    await page.request.post(`${API}/api/comments/${comment.id}/hide`, {
      data: { reason: 'Test hide' },
    });

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Comment removed by moderator')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Unhide' })).toBeVisible();

    await page.getByRole('button', { name: 'Unhide' }).click();
    await expect(page.getByText('To be unhidden')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Comment restored')).toBeVisible();
  });

  test('regular member does not see Hide button', async ({ page, asAlice, bob }) => {
    // Bob is member (default)
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topic = await createTopic(page.request, 'Member Topic');
    const proposal = await createProposal(page.request, topic.id, 'Member proposal');
    await createComment(page.request, proposal.id, 'Normal comment');

    // Switch to Bob's session
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.addInitScript(
      ({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value),
      { key: 'ripple_user', value: JSON.stringify(bob) },
    );

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Normal comment')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Hide' })).not.toBeVisible();
  });

  test('API rejects hide without reason', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'API Topic');
    const proposal = await createProposal(page.request, topic.id, 'API proposal');
    const comment = await createComment(page.request, proposal.id, 'Some comment');

    const res = await page.request.post(`${API}/api/comments/${comment.id}/hide`, {
      data: { reason: '' },
    });
    expect(res.status()).toBe(400);
  });

  test('API rejects hide by non-moderator', async ({ page, asAlice, bob }) => {
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });

    const topic = await createTopic(page.request, 'Auth Topic');
    const proposal = await createProposal(page.request, topic.id, 'Auth proposal');
    const comment = await createComment(page.request, proposal.id, 'Auth comment');

    // Bob's session is now active (page.request after test-setup for bob)
    const res = await page.request.post(`${API}/api/comments/${comment.id}/hide`, {
      data: { reason: 'Trying to abuse' },
    });
    expect(res.status()).toBe(403);
  });
});
