import { test, expect, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal, createComment } from '../helpers';

test.describe('threaded comment replies', () => {
  test('Reply button is visible on comments for logged-in users', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Thread test proposal');
    await createComment(page.request, proposal.id, 'Parent comment');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByRole('button', { name: 'Reply' }).first()).toBeVisible({ timeout: 8000 });
  });

  test('clicking Reply opens an inline reply form', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Reply form test');
    await createComment(page.request, proposal.id, 'Original comment');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Reply' }).first().click();

    await expect(page.getByPlaceholder('Write a reply…')).toBeVisible();
  });

  test('reply textarea is auto-focused when reply form opens', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Reply autofocus test');
    await createComment(page.request, proposal.id, 'Focus parent');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Reply' }).first().click();

    await expect(page.getByPlaceholder('Write a reply…')).toBeFocused({ timeout: 3000 });
  });

  test('can post a reply and it appears nested under the parent', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Post reply test');
    await createComment(page.request, proposal.id, 'Parent comment body');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Reply' }).first().click();
    await page.getByPlaceholder('Write a reply…').fill('This is my reply');
    await page.getByRole('button', { name: 'Post', exact: true }).click();

    // Wait for the reply form to dismiss, then verify the reply is nested
    await expect(page.getByPlaceholder('Write a reply…')).not.toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId('replies-list').getByText('This is my reply')).toBeVisible({ timeout: 8000 });
  });

  test('Cancel button dismisses the reply form', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Cancel reply test');
    await createComment(page.request, proposal.id, 'A comment');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Reply' }).first().click();
    await expect(page.getByPlaceholder('Write a reply…')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByPlaceholder('Write a reply…')).not.toBeVisible();
  });

  test('reply count is included in the discussion count', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Thread count test');
    await createComment(page.request, proposal.id, 'Parent');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Discussion (1)')).toBeVisible({ timeout: 8000 });

    await page.getByRole('button', { name: 'Reply' }).first().click();
    await page.getByPlaceholder('Write a reply…').fill('Reply text');
    await page.getByRole('button', { name: 'Post', exact: true }).click();

    await expect(page.getByText('Discussion (2)')).toBeVisible({ timeout: 8000 });
  });

  test('top-level comments without replies have no nested section', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'No replies yet');
    await createComment(page.request, proposal.id, 'Standalone comment');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Standalone comment')).toBeVisible({ timeout: 8000 });
    await expect(page.getByPlaceholder('Write a reply…')).not.toBeVisible();
  });
});
