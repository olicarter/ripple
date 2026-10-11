import { test, expect, API } from '../fixtures';
import { createTopic, createProposal, createVote, TEST_ORG_ID } from '../helpers';

type ShapeMessage = { value?: { proposal_id: string; user_id: string } };

async function syncedVotes(request: Parameters<typeof createTopic>[0], proposalId: string) {
  const where = encodeURIComponent(`organisation_id = '${TEST_ORG_ID}'`);
  const res = await request.get(`${API}/api/electric/v1/shape?table=votes&offset=-1&where=${where}`);
  expect(res.status()).toBe(200);
  const messages = (await res.json()) as ShapeMessage[];
  return messages.flatMap((m) => (m.value && m.value.proposal_id === proposalId ? [m.value] : []));
}

test.describe('vote integrity', () => {
  test('cannot cast a vote as another user', async ({ page, asAlice, bob }) => {
    const topic = await createTopic(page.request, 'Integrity');
    const proposal = await createProposal(page.request, topic.id, 'Vote as someone else');

    const res = await page.request.post(`${API}/api/votes`, {
      data: { id: crypto.randomUUID(), proposal_id: proposal.id, user_id: bob.id, choice: 'yes' },
    });
    expect(res.status()).toBe(403);
    expect(asAlice.id).not.toBe(bob.id);
  });

  test("cannot change or delete another user's vote", async ({ page, asAlice, bob }) => {
    const topic = await createTopic(page.request, 'Integrity');
    const proposal = await createProposal(page.request, topic.id, 'Tamper with a vote');
    const bobVote = await createVote(page.request, proposal.id, bob.id, 'yes');

    // page.request is signed in as Alice.
    expect(asAlice.id).not.toBe(bob.id);
    const patch = await page.request.patch(`${API}/api/votes/${bobVote.id}`, { data: { choice: 'no' } });
    expect(patch.status()).toBe(403);
    const del = await page.request.delete(`${API}/api/votes/${bobVote.id}`);
    expect(del.status()).toBe(403);
  });

  test("synced votes omit other members' votes on anonymous proposals", async ({ page, asAlice, bob }) => {
    const topic = await createTopic(page.request, 'Anonymous sync');
    const propRes = await page.request.post(`${API}/api/proposals`, {
      data: {
        id: crypto.randomUUID(),
        organisation_id: TEST_ORG_ID,
        topic_id: topic.id,
        title: 'Anonymous sync test',
        status: 'open',
        anonymous_voting: true,
      },
    });
    const { item: proposal } = await propRes.json();
    await createVote(page.request, proposal.id, asAlice.id, 'yes');
    await createVote(page.request, proposal.id, bob.id, 'no');

    const votes = await syncedVotes(page.request, proposal.id);
    expect(votes.map((v) => v.user_id)).toEqual([asAlice.id]);
  });

  test('synced votes include everyone on ordinary proposals', async ({ page, asAlice, bob }) => {
    const topic = await createTopic(page.request, 'Public sync');
    const proposal = await createProposal(page.request, topic.id, 'Public sync test');
    await createVote(page.request, proposal.id, asAlice.id, 'yes');
    await createVote(page.request, proposal.id, bob.id, 'no');

    const votes = await syncedVotes(page.request, proposal.id);
    expect(votes.map((v) => v.user_id).sort()).toEqual([asAlice.id, bob.id].sort());
  });
});
