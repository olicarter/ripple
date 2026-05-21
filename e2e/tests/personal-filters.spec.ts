import { test, expect } from '../fixtures';
import { createTopic, createProposal, createVote, createComment } from '../helpers';

// ── "Mine" filter ─────────────────────────────────────────────────────

test('"Mine" filter is visible when logged in', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/proposals');
  await expect(page.getByRole('button', { name: 'Mine' })).toBeVisible();
});

test('"Mine" shows only proposals authored by current user', async ({ page, asAlice, bob, request }) => {
  const topic = await createTopic(page.request, 'Policy');
  await createProposal(page.request, topic.id, "Alice's proposal");
  await createProposal(request, topic.id, "Bob's proposal");

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Mine' }).click();

  await expect(page.getByText("Alice's proposal")).toBeVisible();
  await expect(page.getByText("Bob's proposal")).not.toBeVisible();
});

test('"Voted" filter is visible when logged in', async ({ page, asAlice }) => {
  await page.goto('/orgs/ripple-test/proposals');
  await expect(page.getByRole('button', { name: 'Voted' })).toBeVisible();
});

test('"Voted" shows only proposals Alice voted on', async ({ page, asAlice, bob }) => {
  const topic = await createTopic(page.request, 'Policy');
  const voted = await createProposal(page.request, topic.id, 'Voted proposal');
  const unvoted = await createProposal(page.request, topic.id, 'Unvoted proposal');

  await createVote(page.request, voted.id, asAlice.id, 'yes');

  await page.goto('/orgs/ripple-test/proposals');
  await page.getByRole('button', { name: 'Voted' }).click();

  await expect(page.getByText('Voted proposal')).toBeVisible();
  await expect(page.getByText('Unvoted proposal')).not.toBeVisible();
});

// ── Comment count on proposal cards ──────────────────────────────────────────

test('comment count is shown on proposal card', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'Commented proposal');
  await createComment(page.request, proposal.id, 'First comment');
  await createComment(page.request, proposal.id, 'Second comment');

  await page.goto('/orgs/ripple-test/proposals');
  await expect(page.getByText('2 comments')).toBeVisible();
});

test('singular "comment" for one comment', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  const proposal = await createProposal(page.request, topic.id, 'One comment proposal');
  await createComment(page.request, proposal.id, 'Only comment');

  await page.goto('/orgs/ripple-test/proposals');
  await expect(page.getByText('1 comment')).toBeVisible();
});

test('no comment count shown when proposal has no comments', async ({ page, asAlice }) => {
  const topic = await createTopic(page.request, 'Policy');
  await createProposal(page.request, topic.id, 'Silent proposal');

  await page.goto('/orgs/ripple-test/proposals');
  await expect(page.getByText(/\d+ comment/)).not.toBeVisible();
});
