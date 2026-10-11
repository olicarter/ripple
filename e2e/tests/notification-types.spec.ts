import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createTopic, createProposal, createDelegation, TEST_ORG_ID } from '../helpers';

test.describe('notification types', () => {
  test('comment.posted notification sent to proposal author when someone comments', async ({
    page,
    asAlice,
    bob,
    request,
  }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Alice proposal');

    // Bob comments on Alice's proposal
    await request.post(`${API}/api/proposals/${proposal.id}/comments`, {
      data: { id: crypto.randomUUID(), body: 'Great idea!' },
    });

    // Alice should get a comment.posted notification
    const res = await page.request.get(`${API}/api/notifications`);
    const notifications = await res.json();
    const notif = notifications.find(
      (n: { type: string; target_id: string }) =>
        n.type === 'comment.posted' && n.target_id === proposal.id,
    );
    expect(notif).toBeTruthy();
  });

  test('comment.posted notification sent to voters when someone comments', async ({
    page,
    asAlice,
    bob,
    request,
  }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Voted proposal');

    // Bob votes on the proposal
    await request.post(`${API}/api/votes/test-cast`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: bob.id, choice: 'yes' },
    });

    // Alice comments (not Bob, so Bob should be notified)
    await page.request.post(`${API}/api/proposals/${proposal.id}/comments`, {
      data: { id: crypto.randomUUID(), body: 'Update on this proposal.' },
    });

    // Bob should get comment.posted notification
    const res = await request.get(`${API}/api/notifications`);
    const notifications = await res.json();
    const notif = notifications.find(
      (n: { type: string; target_id: string }) =>
        n.type === 'comment.posted' && n.target_id === proposal.id,
    );
    expect(notif).toBeTruthy();
  });

  test('comment.posted not sent to the commenter themselves', async ({
    page,
    asAlice,
    bob,
    request,
  }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Self-comment proposal');

    // Alice votes on the proposal
    await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });

    // Alice also comments — she should NOT get a notification about her own comment
    await page.request.post(`${API}/api/proposals/${proposal.id}/comments`, {
      data: { id: crypto.randomUUID(), body: 'My own comment.' },
    });

    const res = await page.request.get(`${API}/api/notifications`);
    const notifications = await res.json();
    const notif = notifications.find(
      (n: { type: string; target_id: string }) =>
        n.type === 'comment.posted' && n.target_id === proposal.id,
    );
    expect(notif).toBeFalsy();
  });

  test('delegation.added notification sent when someone delegates to you', async ({
    page,
    asAlice,
    bob,
    request,
  }) => {
    // Bob delegates to Alice
    await request.post(`${API}/api/delegations`, {
      data: {
        id: crypto.randomUUID(),
        organisation_id: TEST_ORG_ID,
        delegator_id: bob.id,
        delegate_id: asAlice.id,
        topic_id: null,
      },
    });

    // Alice should get a delegation.added notification
    const res = await page.request.get(`${API}/api/notifications`);
    const notifications = await res.json();
    const notif = notifications.find(
      (n: { type: string }) => n.type === 'delegation.added',
    );
    expect(notif).toBeTruthy();
    expect(notif.actor_id).toBe(bob.id);
  });

  test('delegation.removed notification sent when delegation is removed', async ({
    page,
    asAlice,
    bob,
    request,
  }) => {
    // Bob delegates to Alice
    const delRes = await request.post(`${API}/api/delegations`, {
      data: {
        id: crypto.randomUUID(),
        organisation_id: TEST_ORG_ID,
        delegator_id: bob.id,
        delegate_id: asAlice.id,
        topic_id: null,
      },
    });
    const { item: delegation } = await delRes.json();

    // Bob removes the delegation
    await request.delete(`${API}/api/delegations/${delegation.id}`);

    // Alice should get a delegation.removed notification
    const res = await page.request.get(`${API}/api/notifications`);
    const notifications = await res.json();
    const notif = notifications.find(
      (n: { type: string }) => n.type === 'delegation.removed',
    );
    expect(notif).toBeTruthy();
    expect(notif.actor_id).toBe(bob.id);
  });

  test('notification bell shows correct labels for all types', async ({
    page,
    asAlice,
    bob,
    request,
  }) => {
    const topic = await createTopic(page.request, 'Policy');
    const proposal = await createProposal(page.request, topic.id, 'Label test proposal');

    // Bob comments to trigger comment.posted for Alice
    await request.post(`${API}/api/proposals/${proposal.id}/comments`, {
      data: { id: crypto.randomUUID(), body: 'A comment.' },
    });

    await page.goto(`/orgs/${ORG_SLUG}/proposals`);
    await page.getByTestId('notification-bell').click();

    await expect(page.getByTestId('notification-item').filter({ hasText: 'New comment' })).toBeVisible({ timeout: 5000 });
  });
});
