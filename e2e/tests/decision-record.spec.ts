import { test, expect, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal } from '../helpers';

test.describe('Decision record', () => {
  test('nav link exists and decisions page loads', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/proposals`);

    // Decisions nav link should be visible in the org layout
    await expect(page.getByRole('link', { name: 'Decisions' })).toBeVisible({ timeout: 10000 });

    // Navigate to decisions page
    await page.getByRole('link', { name: 'Decisions' }).click();
    await expect(page).toHaveURL(/\/decisions/);
    await expect(page.getByRole('heading', { name: 'Decision record' })).toBeVisible();
    await expect(page.getByTestId('export-csv-btn')).toBeVisible();
  });

  test('shows empty state when no decisions', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/decisions`);
    await expect(page.getByText('No decisions yet')).toBeVisible({ timeout: 10000 });
  });

  test('export CSV button is disabled with no decisions', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/decisions`);
    await expect(page.getByTestId('export-csv-btn')).toBeDisabled({ timeout: 10000 });
  });

  test('closed proposal appears in decision record', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Decision Topic');
    await createProposal(page.request, topic.id, 'My closed proposal', { status: 'closed' });

    await page.goto(`/orgs/${ORG_SLUG}/decisions`);
    await expect(page.getByTestId('decision-row')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('My closed proposal')).toBeVisible();
  });

  test('filter pills exist and are interactive', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/decisions`);

    for (const f of ['all', 'passed', 'failed', 'withdrawn', 'no-votes']) {
      await expect(page.getByTestId(`filter-${f}`)).toBeVisible({ timeout: 10000 });
    }

    // Click a filter and confirm it activates
    await page.getByTestId('filter-passed').click();
    await expect(page.getByTestId('filter-passed')).toHaveClass(/filterPillActive/);
  });
});
