import { test, expect, API, ORG_SLUG } from '../fixtures';

const STORAGE_KEY = 'ripple_user';

async function switchToBob(page: any, bob: { id: string; name: string; email: string; created_at: string }) {
  // Switch page session cookie to Bob
  await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
  // Overwrite localStorage (addInitScript runs in registration order; this runs after Alice's)
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => localStorage.setItem(key, value),
    { key: STORAGE_KEY, value: JSON.stringify(bob) },
  );
}

test.describe('admin panel', () => {
  test('admin sees Admin link in nav', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals`);
    await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  });

  test('admin can navigate to admin page', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
  });

  test('member does not see Admin link in nav', async ({ page, asAlice, bob }) => {
    // Downgrade Bob from the auto-admin test-setup to member
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await switchToBob(page, bob);
    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals`);
    await expect(page.getByRole('link', { name: 'Admin' })).not.toBeVisible();
  });

  test('member sees access denied on admin page', async ({ page, asAlice, bob }) => {
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await switchToBob(page, bob);
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await expect(page.getByText('Access denied')).toBeVisible();
  });

  test('admin can update org name', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    const nameInput = page.locator('#admin-name');
    await nameInput.fill('Ripple Updated');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Organisation updated')).toBeVisible();
  });

  test('admin can change proposal creation role', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await page.locator('input[name="proposal_creation_role"][value="admin"]').click();
    await expect(page.getByText('Setting saved')).toBeVisible();
  });

  test('proposal creation button hidden for member when set to admin-only', async ({ page, asAlice, bob }) => {
    // Set org to admin-only proposal creation (as Alice)
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, {
      data: { proposal_creation_role: 'admin' },
    });

    // Set up Bob as member
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    await switchToBob(page, bob);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals`);
    await expect(page.getByRole('button', { name: '+ New proposal' })).not.toBeVisible();
  });

  test('API rejects proposal creation by member when set to admin-only', async ({ page, asAlice, bob, org }) => {
    // Create a topic while still Alice's session
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000111', organisation_id: org.id, name: 'Test Topic' },
    });
    const topicData = await topicRes.json();

    // Set org to admin-only
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, {
      data: { proposal_creation_role: 'admin' },
    });

    // Switch to Bob and downgrade to member
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });

    // Bob tries to create a proposal via page.request (Bob's session)
    const res = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000099',
        organisation_id: org.id,
        topic_id: topicData.item.id,
        title: 'Should not be allowed',
      },
    });
    expect(res.status()).toBe(403);
  });

  test('admin can delete the organisation', async ({ page, asAlice }) => {
    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    await page.getByRole('button', { name: 'Delete organisation' }).click();
    await page.getByRole('button', { name: 'Yes, delete permanently' }).click();
    await expect(page).toHaveURL(`${API}/`);
  });

  test('admin can transfer ownership to a member', async ({ page, asAlice, bob }) => {
    // Use page.request so Bob ends up in ripple-test; page session cookie becomes Bob's
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    // Restore Alice's session cookie (test-setup returns the session for the given user)
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: asAlice.name, email: asAlice.email } });

    await page.goto(`${API}/orgs/${ORG_SLUG}/admin`);
    // Wait for Bob to appear in the transfer ownership dropdown (Electric sync)
    const transferSection = page.locator('section').filter({ hasText: 'Transfer ownership' });
    const transferSelect = transferSection.locator('select');
    await expect(transferSelect).toContainText(`${bob.name}`);
    await transferSelect.selectOption({ label: `${bob.name} (member)` });
    await page.getByRole('button', { name: 'Transfer ownership' }).click();
    await page.getByRole('button', { name: 'Yes, transfer' }).click();

    // Alice is demoted — she gets redirected away and shown a toast
    await expect(page.getByText(/Ownership transferred/)).toBeVisible();
    // Alice is now on the proposals page (redirected by the transfer handler)
    await expect(page).toHaveURL(`${API}/orgs/${ORG_SLUG}/proposals`);
  });

  test('API rejects transfer ownership by a non-admin', async ({ page, asAlice, bob, org }) => {
    // Add Bob to ripple-test; page session becomes Bob's
    await page.request.post(`${API}/api/auth/test-setup`, { data: { name: bob.name, email: bob.email } });
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}/members/${bob.id}`, { data: { role: 'member' } });
    // Page session is now Bob (a member). Bob tries to transfer ownership to Alice.
    const res = await page.request.post(`${API}/api/orgs/${ORG_SLUG}/transfer-ownership`, {
      data: { to_user_id: asAlice.id },
    });
    // Bob is a member, not admin — should get 403
    expect(res.status()).toBe(403);
  });

  test('voting visibility: tally hidden on open proposal when set to hidden', async ({ page, asAlice, org }) => {
    // Set voting visibility to hidden
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { voting_visibility: 'hidden' } });

    // Create a topic and open proposal
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000201', organisation_id: org.id, name: 'Vis Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000202',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Visibility test proposal',
        status: 'open',
      },
    });
    const prop = await propRes.json();

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    await expect(page.getByText('Vote counts are hidden until this proposal closes')).toBeVisible();
    // The tally text should not appear
    await expect(page.getByText(/votes total/)).not.toBeVisible();
  });

  test('voting visibility: tally visible on open proposal when set to public', async ({ page, asAlice, org }) => {
    // voting_visibility defaults to 'public'
    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000203', organisation_id: org.id, name: 'Pub Vis Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000204',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Public visibility test',
        status: 'open',
      },
    });
    const prop = await propRes.json();

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    // Should show the Results section with tally (not the hidden message)
    await expect(page.getByText('Vote counts are hidden until this proposal closes')).not.toBeVisible();
    await expect(page.getByText('Results')).toBeVisible();
  });

  test('voting visibility: tally visible on closed proposal even when set to hidden', async ({ page, asAlice, org }) => {
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { voting_visibility: 'hidden' } });

    const topicRes = await page.request.post(`${API}/api/topics`, {
      data: { id: '00000000-0000-0000-0000-000000000205', organisation_id: org.id, name: 'Closed Vis Topic' },
    });
    const topic = await topicRes.json();
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: '00000000-0000-0000-0000-000000000206',
        organisation_id: org.id,
        topic_id: topic.item.id,
        title: 'Closed visibility test',
        status: 'open',
      },
    });
    const prop = await propRes.json();

    // Close the proposal
    await page.request.post(`${API}/api/proposals/${prop.item.id}/close`);

    await page.goto(`${API}/orgs/${ORG_SLUG}/proposals/${prop.item.id}`);
    // Closed proposal should always show tally
    await expect(page.getByText('Vote counts are hidden until this proposal closes')).not.toBeVisible();
    await expect(page.getByText('Results')).toBeVisible();
  });
});
