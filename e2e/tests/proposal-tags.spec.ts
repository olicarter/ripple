import { test, expect, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal } from '../helpers';

test.describe('proposal tags', () => {
  test('author can add tags when editing a proposal', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Tag me');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('tag-input').fill('urgent');
    await page.getByTestId('add-tag-btn').click();
    await page.getByTestId('tag-input').fill('budget');
    await page.getByTestId('add-tag-btn').click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('proposal-tag').first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('urgent')).toBeVisible();
    await expect(page.getByText('budget')).toBeVisible();
  });

  test('tags appear on proposal card in list', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Tagged proposal');

    // Add a tag via edit
    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('tag-input').fill('environment');
    await page.getByTestId('add-tag-btn').click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('proposal-tag').first()).toBeVisible({ timeout: 6000 });

    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await expect(page.getByTestId('proposal-card-tag-environment')).toBeVisible({ timeout: 6000 });
  });

  test('tag filter button appears when proposals have tags', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Tagged for filter');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('tag-input').fill('finance');
    await page.getByTestId('add-tag-btn').click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('proposal-tag').first()).toBeVisible({ timeout: 6000 });

    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await expect(page.getByTestId('tag-filter-finance')).toBeVisible({ timeout: 6000 });
  });

  test('clicking tag filter shows only matching proposals', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const p1 = await createProposal(page.request, topic.id, 'Tagged with foo');
    await createProposal(page.request, topic.id, 'No tags here');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${p1.id}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('tag-input').fill('foo');
    await page.getByTestId('add-tag-btn').click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('proposal-tag').first()).toBeVisible({ timeout: 6000 });

    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await page.getByTestId('tag-filter-foo').click();

    await expect(page.getByText('Tagged with foo')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('No tags here')).not.toBeVisible();
  });

  test('can remove a tag when editing', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Remove tag test');

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.getByTestId('tag-input').fill('removable');
    await page.getByTestId('add-tag-btn').click();
    // Remove the tag
    await page.locator('button', { hasText: '×' }).first().click();
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByTestId('proposal-tag')).not.toBeVisible({ timeout: 5000 });
  });
});
