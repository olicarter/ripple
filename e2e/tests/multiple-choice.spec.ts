import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, TEST_ORG_ID } from '../helpers';
import { randomUUID } from 'crypto';

test.describe('multiple choice proposals', () => {
  test('Multiple choice type can be selected when creating a proposal', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await page.getByRole('button', { name: /New proposal/i }).click();
    await expect(page.getByTestId('proposal-type-multiple_choice')).toBeVisible();
  });

  test('option inputs appear when Multiple choice type is selected', async ({ page, asAlice }) => {
    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await page.getByRole('button', { name: /New proposal/i }).click();
    await page.getByTestId('proposal-type-multiple_choice').click();

    await expect(page.getByTestId('mc-option-0')).toBeVisible();
    await expect(page.getByTestId('mc-option-1')).toBeVisible();
    await expect(page.getByTestId('mc-add-option')).toBeVisible();
  });

  test('multiple choice proposal shows badge in list', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await page.getByRole('button', { name: /New proposal/i }).click();

    await page.locator('#new-proposal-topic').selectOption(topic.id);
    await page.getByTestId('proposal-type-multiple_choice').click();
    await page.locator('#new-proposal-title').fill('Best colour?');
    await page.getByTestId('mc-option-0').fill('Red');
    await page.getByTestId('mc-option-1').fill('Blue');
    await page.getByRole('button', { name: 'Create proposal' }).click();

    await expect(page.getByText('Multiple choice').first()).toBeVisible({ timeout: 8000 });
  });

  test('multiple choice proposal shows option voting buttons on detail page', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposalId = randomUUID();

    // Create proposal via API
    await page.request.post(`${API}/api/proposals`, {
      data: {
        id: proposalId,
        organisation_id: TEST_ORG_ID,
        topic_id: topic.id,
        title: 'Pick a colour',
        proposal_type: 'multiple_choice',
      },
    });

    // Create options via API
    const optA = randomUUID();
    const optB = randomUUID();
    await page.request.post(`${API}/api/proposals/${proposalId}/options`, {
      data: { id: optA, text: 'Red', position: 0 },
    });
    await page.request.post(`${API}/api/proposals/${proposalId}/options`, {
      data: { id: optB, text: 'Blue', position: 1 },
    });

    // Navigate to the proposal detail
    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposalId}`);

    // Should see option buttons
    await expect(page.getByTestId(`vote-option-${optA}`)).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId(`vote-option-${optB}`)).toBeVisible();

    // Should NOT see yes/no/abstain buttons
    await expect(page.getByRole('button', { name: 'yes' })).not.toBeVisible();
  });

  test('casting a vote on a multiple choice proposal works', async ({ page, asAlice }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposalId = randomUUID();

    await page.request.post(`${API}/api/proposals`, {
      data: {
        id: proposalId,
        organisation_id: TEST_ORG_ID,
        topic_id: topic.id,
        title: 'Pick a fruit',
        proposal_type: 'multiple_choice',
      },
    });

    const optA = randomUUID();
    const optB = randomUUID();
    await page.request.post(`${API}/api/proposals/${proposalId}/options`, {
      data: { id: optA, text: 'Apple', position: 0 },
    });
    await page.request.post(`${API}/api/proposals/${proposalId}/options`, {
      data: { id: optB, text: 'Banana', position: 1 },
    });

    await page.goto(`/orgs/${ORG_SLUG}/proposals/${proposalId}`);
    await page.getByTestId(`vote-option-${optA}`).click({ timeout: 8000 });

    await expect(page.getByText('You voted for').first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText('Apple').first()).toBeVisible();
  });

  test('tally shows per-option results', async ({ page, asAlice, bob, request }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposalId = randomUUID();

    await page.request.post(`${API}/api/proposals`, {
      data: {
        id: proposalId,
        organisation_id: TEST_ORG_ID,
        topic_id: topic.id,
        title: 'Favourite animal',
        proposal_type: 'multiple_choice',
      },
    });
    const optA = randomUUID();
    const optB = randomUUID();
    await page.request.post(`${API}/api/proposals/${proposalId}/options`, {
      data: { id: optA, text: 'Cat', position: 0 },
    });
    await page.request.post(`${API}/api/proposals/${proposalId}/options`, {
      data: { id: optB, text: 'Dog', position: 1 },
    });

    // Alice votes Cat, Bob votes Dog
    await page.request.post(`${API}/api/votes`, {
      data: { id: randomUUID(), proposal_id: proposalId, user_id: asAlice.id, option_id: optA },
    });
    await request.post(`${API}/api/votes/test-cast`, {
      data: { id: randomUUID(), proposal_id: proposalId, user_id: bob.id, option_id: optB },
    });

    // Check tally API
    const tallyRes = await page.request.get(`${API}/api/proposals/${proposalId}/tally`);
    const tally = await tallyRes.json();
    expect(tally.total).toBe(2);
    expect(tally.options).toHaveLength(2);
    const catOption = tally.options.find((o: { text: string }) => o.text === 'Cat');
    const dogOption = tally.options.find((o: { text: string }) => o.text === 'Dog');
    expect(catOption?.count).toBe(1);
    expect(dogOption?.count).toBe(1);
  });
});
