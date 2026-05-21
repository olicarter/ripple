import { test, expect, API } from '../fixtures';
import { createTopic, createProposal, createComment } from '../helpers';

test('own comment shows Edit button', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Editable comments');
  await createComment(page.request, proposal.id, 'My original comment');

  await page.goto(`/orgs/ripple-test/proposals/${proposal.id}`);
  await expect(page.getByTestId('comment-edit-btn').first()).toBeVisible();
});

test('can edit own comment', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Edit comment test');
  await createComment(page.request, proposal.id, 'Original comment text');

  await page.goto(`/orgs/ripple-test/proposals/${proposal.id}`);
  await page.getByTestId('comment-edit-btn').first().click();

  const textarea = page.getByTestId('comment-edit-textarea');
  await textarea.clear();
  await textarea.fill('Updated comment text');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('Comment updated')).toBeVisible();
  await expect(page.getByText('Updated comment text')).toBeVisible();
  await expect(page.getByText('Original comment text')).not.toBeVisible();
});

test('edited comment shows "(edited)" label', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Edited label test');
  await createComment(page.request, proposal.id, 'First version');

  await page.goto(`/orgs/ripple-test/proposals/${proposal.id}`);
  await page.getByTestId('comment-edit-btn').first().click();
  const textarea = page.getByTestId('comment-edit-textarea');
  await textarea.clear();
  await textarea.fill('Second version');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText('(edited)')).toBeVisible();
});

test('cancel edit restores original comment', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Cancel edit test');
  await createComment(page.request, proposal.id, 'Keep this comment');

  await page.goto(`/orgs/ripple-test/proposals/${proposal.id}`);
  await page.getByTestId('comment-edit-btn').first().click();
  const textarea = page.getByTestId('comment-edit-textarea');
  await textarea.clear();
  await textarea.fill('Discarded change');
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click();

  await expect(page.getByText('Keep this comment')).toBeVisible();
  await expect(page.getByText('Discarded change')).not.toBeVisible();
});

test('API rejects editing another user comment', async ({ page, asAlice, bob, request }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Ownership test');
  // Bob posts a comment
  const comment = await createComment(request, proposal.id, "Bob's comment");

  // Alice tries to edit Bob's comment
  const res = await page.request.patch(`${API}/api/comments/${comment.id}`, {
    data: { body: 'Hacked body' },
  });
  expect(res.status()).toBe(403);
});

test('comments render markdown', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Markdown comments');
  await createComment(page.request, proposal.id, '**Bold text**');

  await page.goto(`/orgs/ripple-test/proposals/${proposal.id}`);
  await expect(page.locator('strong').filter({ hasText: 'Bold text' })).toBeVisible();
});
