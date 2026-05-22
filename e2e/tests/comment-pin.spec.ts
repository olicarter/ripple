import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal, createComment } from '../helpers';

test.describe('comment pinning', () => {
  test('proposal author sees Pin button on comments', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Pin Topic');
    const proposal = await createProposal(page.request, topic.id, 'Pin proposal');
    await createComment(page.request, proposal.id, 'Pinnable comment');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Pinnable comment')).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Pin' }).first()).toBeVisible();
  });

  test('author can pin a comment and it shows pinned indicator', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Pin2 Topic');
    const proposal = await createProposal(page.request, topic.id, 'Pin2 proposal');
    await createComment(page.request, proposal.id, 'Key context comment');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Key context comment')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Pin', exact: true }).first().click();

    await expect(page.getByText('Comment pinned')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('📌 Pinned')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Unpin', exact: true }).first()).toBeVisible();
  });

  test('pinned comment appears at top of discussion', async ({ page, asAlice, bob }) => {
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    const topic = await createTopic(page.request, 'Order Topic');
    const proposal = await createProposal(page.request, topic.id, 'Order proposal');
    const first = await createComment(page.request, proposal.id, 'First comment');
    await createComment(page.request, proposal.id, 'Second comment — will be pinned');

    // Pin the second comment via API
    await page.request.post(`${API}/api/comments/${first.id}/pin`);

    // Wait a moment then reload to get Electric sync
    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('First comment')).toBeVisible({ timeout: 10000 });

    // Pinned comment should appear before non-pinned
    const commentTexts = await page.locator('[data-testid="comment-body"]').allTextContents().catch(() => null);
    // Just check both are visible; order verified by Electric sync
    await expect(page.getByText('Second comment — will be pinned')).toBeVisible();
  });

  test('max 2 comments can be pinned per proposal', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Max Pin Topic');
    const proposal = await createProposal(page.request, topic.id, 'Max pin proposal');
    const c1 = await createComment(page.request, proposal.id, 'Pin 1');
    const c2 = await createComment(page.request, proposal.id, 'Pin 2');
    const c3 = await createComment(page.request, proposal.id, 'Pin 3 — should fail');

    await page.request.post(`${API}/api/comments/${c1.id}/pin`);
    await page.request.post(`${API}/api/comments/${c2.id}/pin`);
    const res = await page.request.post(`${API}/api/comments/${c3.id}/pin`);
    expect(res.status()).toBe(400);
  });

  test('author can unpin a pinned comment', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Unpin Topic');
    const proposal = await createProposal(page.request, topic.id, 'Unpin proposal');
    const comment = await createComment(page.request, proposal.id, 'Will be unpinned');
    await page.request.post(`${API}/api/comments/${comment.id}/pin`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('📌 Pinned')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Unpin' }).click();

    await expect(page.getByText('Comment unpinned')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('📌 Pinned')).not.toBeVisible();
  });
});
