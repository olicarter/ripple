import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal } from '../helpers';

test.describe('for/against arguments', () => {
  test('arguments section is visible on proposal detail page', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Arg Topic');
    const proposal = await createProposal(page.request, topic.id, 'Arg proposal');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Arguments (0)')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('No for arguments yet.')).toBeVisible();
    await expect(page.getByText('No against arguments yet.')).toBeVisible();
  });

  test('member can add a for argument', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'For Topic');
    const proposal = await createProposal(page.request, topic.id, 'For proposal');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Arguments (0)')).toBeVisible({ timeout: 10000 });

    await page.locator('input[name="arg-side"][value="for"]').check();
    await page.getByPlaceholder(/Add a for argument/).fill('This will improve outcomes significantly.');
    await page.getByRole('button', { name: 'Add argument' }).click();

    await expect(page.getByText('For argument added')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('argument-for')).toBeVisible();
    await expect(page.getByText('This will improve outcomes significantly.')).toBeVisible();
    await expect(page.getByText('Arguments (1)')).toBeVisible();
  });

  test('member can add an against argument', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Against Topic');
    const proposal = await createProposal(page.request, topic.id, 'Against proposal');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Arguments (0)')).toBeVisible({ timeout: 10000 });

    await page.locator('input[name="arg-side"][value="against"]').check();
    await page.getByPlaceholder(/Add an against argument/).fill('The costs outweigh the benefits.');
    await page.getByRole('button', { name: 'Add argument' }).click();

    await expect(page.getByText('Against argument added')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('argument-against')).toBeVisible();
    await expect(page.getByText('The costs outweigh the benefits.')).toBeVisible();
  });

  test('author can remove their own argument', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Remove Topic');
    const proposal = await createProposal(page.request, topic.id, 'Remove proposal');

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText('Arguments (0)')).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder(/Add a for argument/).fill('Argument to delete');
    await page.getByRole('button', { name: 'Add argument' }).click();
    await expect(page.getByText('Argument to delete')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(page.getByText('Argument removed')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Argument to delete')).not.toBeVisible();
  });

  test('argument form not shown on closed proposals', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Closed Arg Topic');
    const proposal = await createProposal(page.request, topic.id, 'Closed arg proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${proposal.id}`);
    await expect(page.getByText(/Arguments/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Add argument' })).not.toBeVisible();
  });

  test('API rejects argument on closed proposal', async ({ page, asAlice, org }) => {
    const topic = await createTopic(page.request, 'Closed API Topic');
    const proposal = await createProposal(page.request, topic.id, 'Closed API proposal');
    await page.request.post(`${API}/api/proposals/${proposal.id}/close`);

    const res = await page.request.post(`${API}/api/proposals/${proposal.id}/arguments`, {
      data: { id: crypto.randomUUID(), side: 'for', body: 'Too late' },
    });
    expect(res.status()).toBe(400);
  });
});
