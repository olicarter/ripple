import { request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import { test, expect, API, ORG_SLUG } from '../fixtures';
import { createOrg, createDelegation, TEST_ORG_ID } from '../helpers';

// `request` is signed in as Bob (the bob fixture), `page.request` as Alice.

async function createPrivateOrgWithProposal(bobRequest: APIRequestContext, status: 'open' | 'draft' = 'open') {
  const org = await createOrg(bobRequest, `Bob Private ${crypto.randomUUID().slice(0, 8)}`);
  const topicId = crypto.randomUUID();
  await bobRequest.post(`${API}/api/topics`, { data: { id: topicId, organisation_id: org.id, name: 'Private topic' } });
  const res = await bobRequest.post(`${API}/api/proposals`, {
    data: { id: crypto.randomUUID(), organisation_id: org.id, topic_id: topicId, title: 'Private proposal', status },
  });
  const { item: proposal } = await res.json();
  return { org, proposal: proposal as { id: string } };
}

async function anonymous() {
  return playwrightRequest.newContext({ ignoreHTTPSErrors: true });
}

test.describe('access control', () => {
  test("non-members can't read a private org's proposals", async ({ page, request, asAlice, bob }) => {
    expect(asAlice.id).not.toBe(bob.id);
    const { org, proposal } = await createPrivateOrgWithProposal(request);

    expect((await request.get(`${API}/api/proposals/${proposal.id}`)).status()).toBe(200);
    expect((await page.request.get(`${API}/api/proposals/${proposal.id}`)).status()).toBe(403);
    expect((await page.request.get(`${API}/api/proposals/${proposal.id}/tally`)).status()).toBe(403);
    expect((await page.request.get(`${API}/api/proposals/${proposal.id}/comments`)).status()).toBe(403);
    expect((await page.request.get(`${API}/api/proposals?org=${org.id}`)).status()).toBe(403);

    const anon = await anonymous();
    expect((await anon.get(`${API}/api/proposals/${proposal.id}`)).status()).toBe(403);
    expect((await anon.get(`${API}/api/orgs/${org.slug}/members`)).status()).toBe(403);
    await anon.dispose();
  });

  test("non-members can't vote or comment in a private org", async ({ page, request, asAlice, bob }) => {
    expect(bob.id).not.toBe(asAlice.id);
    const { proposal } = await createPrivateOrgWithProposal(request);

    const vote = await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: asAlice.id, choice: 'yes' },
    });
    expect(vote.status()).toBe(403);
    const comment = await page.request.post(`${API}/api/proposals/${proposal.id}/comments`, {
      data: { id: crypto.randomUUID(), body: 'Let me in' },
    });
    expect(comment.status()).toBe(403);
  });

  test('drafts are only visible to their author', async ({ page, request, asAlice, bob }) => {
    expect(asAlice.id).not.toBe(bob.id);
    const topicId = crypto.randomUUID();
    await request.post(`${API}/api/topics`, { data: { id: topicId, organisation_id: TEST_ORG_ID, name: 'Drafts' } });
    const res = await request.post(`${API}/api/proposals`, {
      data: { id: crypto.randomUUID(), organisation_id: TEST_ORG_ID, topic_id: topicId, title: "Bob's draft", status: 'draft' },
    });
    const { item: draft } = await res.json();

    expect((await request.get(`${API}/api/proposals/${draft.id}`)).status()).toBe(200);
    expect((await page.request.get(`${API}/api/proposals/${draft.id}`)).status()).toBe(404);
    const list = await (await page.request.get(`${API}/api/proposals?org=${TEST_ORG_ID}`)).json();
    expect(list.items.map((p: { id: string }) => p.id)).not.toContain(draft.id);
  });

  test("ordinary members can't delete someone else's proposal", async ({ page, request, asAlice, bob }) => {
    expect(bob.id).not.toBe(asAlice.id);
    const { org, proposal } = await createPrivateOrgWithProposal(request);
    const add = await request.post(`${API}/api/orgs/${org.slug}/members`, { data: { user_id: asAlice.id, role: 'member' } });
    expect(add.status()).toBe(201);

    expect((await page.request.get(`${API}/api/proposals/${proposal.id}`)).status()).toBe(200);
    expect((await page.request.delete(`${API}/api/proposals/${proposal.id}`)).status()).toBe(403);
    expect((await request.get(`${API}/api/proposals/${proposal.id}`)).status()).toBe(200);
  });

  test('member listing never includes unsubscribe tokens', async ({ page, asAlice }) => {
    expect(asAlice.id).toBeTruthy();
    const members = await (await page.request.get(`${API}/api/orgs/${ORG_SLUG}/members`)).json();
    expect(members.length).toBeGreaterThan(0);
    for (const m of members) expect(m).not.toHaveProperty('unsubscribe_token');
  });

  test('delegations can only be created and removed by the delegator', async ({ page, request, asAlice, bob }) => {
    const asSomeoneElse = await page.request.post(`${API}/api/delegations`, {
      data: { id: crypto.randomUUID(), organisation_id: TEST_ORG_ID, delegator_id: bob.id, delegate_id: asAlice.id },
    });
    expect(asSomeoneElse.status()).toBe(403);

    const aliceDelegation = await createDelegation(page.request, asAlice.id, bob.id);
    expect((await request.delete(`${API}/api/delegations/${aliceDelegation.id}`)).status()).toBe(403);
    expect((await page.request.delete(`${API}/api/delegations/${aliceDelegation.id}`)).status()).toBe(200);
  });

  test('public org content stays readable without signing in', async ({ page, asAlice }) => {
    expect(asAlice.id).toBeTruthy();
    await page.request.patch(`${API}/api/orgs/${ORG_SLUG}`, { data: { is_public: true } });
    const topicId = crypto.randomUUID();
    await page.request.post(`${API}/api/topics`, { data: { id: topicId, organisation_id: TEST_ORG_ID, name: 'Public' } });
    const res = await page.request.post(`${API}/api/proposals`, {
      data: { id: crypto.randomUUID(), organisation_id: TEST_ORG_ID, topic_id: topicId, title: 'Public proposal', status: 'open' },
    });
    const { item: proposal } = await res.json();

    const anon = await anonymous();
    expect((await anon.get(`${API}/api/proposals/${proposal.id}`)).status()).toBe(200);
    expect((await anon.get(`${API}/api/proposals/${proposal.id}/tally`)).status()).toBe(200);
    await anon.dispose();
  });
});
