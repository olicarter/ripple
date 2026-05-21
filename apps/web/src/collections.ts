import { electricCollectionOptions } from '@tanstack/electric-db-collection';
import { createCollection } from '@tanstack/react-db';
import {
  usersApi, topicsApi, proposalsApi, proposalOptionsApi, delegationsApi, votesApi, commentsApi, orgsApi, argumentsApi,
  type User, type Organisation, type Membership, type Topic, type Proposal, type ProposalOption,
  type Delegation, type Vote, type Comment, type CommentReaction, type Argument, type Veto,
} from './api';

const shapeUrl = `${window.location.origin}/electric/v1/shape`;

// Global collections (not org-scoped)
export const usersCollection = createCollection(
  electricCollectionOptions<User>({
    id: 'users',
    shapeOptions: { url: shapeUrl, params: { table: 'users' } },
    getKey: (row: unknown) => (row as User).id,
    onInsert: async ({ transaction }) => {
      const user = transaction.mutations[0].modified as User;
      const result = await usersApi.create({ id: user.id, name: user.name, email: user.email });
      return { txid: result.txid };
    },
    onUpdate: async ({ transaction }) => {
      const user = transaction.mutations[0].modified as User;
      const result = await usersApi.update(user.id, { name: user.name, email: user.email });
      return { txid: result.txid };
    },
    onDelete: async ({ transaction }) => {
      const user = transaction.mutations[0].original as User;
      const result = await usersApi.delete(user.id);
      return { txid: result.txid };
    },
  }),
);

export const organisationsCollection = createCollection(
  electricCollectionOptions<Organisation>({
    id: 'organisations',
    shapeOptions: { url: shapeUrl, params: { table: 'organisations' } },
    getKey: (row: unknown) => (row as Organisation).id,
    onInsert: async ({ transaction }) => {
      const org = transaction.mutations[0].modified as Organisation;
      const result = await orgsApi.create({ name: org.name, slug: org.slug, description: org.description });
      return { txid: result.txid };
    },
    onUpdate: async ({ transaction }) => {
      const org = transaction.mutations[0].modified as Organisation;
      const result = await orgsApi.update(org.slug, { name: org.name, description: org.description });
      return { txid: result.txid };
    },
    onDelete: async ({ transaction }) => {
      const org = transaction.mutations[0].original as Organisation;
      const result = await orgsApi.delete(org.slug);
      return { txid: result.txid };
    },
  }),
);

export const membershipsCollection = createCollection(
  electricCollectionOptions<Membership>({
    id: 'memberships',
    shapeOptions: { url: shapeUrl, params: { table: 'memberships' } },
    getKey: (row: unknown) => (row as Membership).id,
    // Memberships are managed via orgsApi, not direct Electric mutations
  }),
);

// Per-org collections — created once per org slug, filtered server-side via Electric WHERE clause
export function createOrgCollections(orgId: string) {
  const where = `organisation_id = '${orgId}'`;

  const topicsCollection = createCollection(
    electricCollectionOptions<Topic>({
      id: `topics-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'topics', where } },
      getKey: (row: unknown) => (row as Topic).id,
      onInsert: async ({ transaction }) => {
        const topic = transaction.mutations[0].modified as Topic;
        const result = await topicsApi.create({ id: topic.id, organisation_id: orgId, name: topic.name, description: topic.description });
        return { txid: result.txid };
      },
      onUpdate: async ({ transaction }) => {
        const topic = transaction.mutations[0].modified as Topic;
        const result = await topicsApi.update(topic.id, { name: topic.name, description: topic.description, is_constitutional: topic.is_constitutional });
        return { txid: result.txid };
      },
      onDelete: async ({ transaction }) => {
        const topic = transaction.mutations[0].original as Topic;
        const result = await topicsApi.delete(topic.id);
        return { txid: result.txid };
      },
    }),
  );

  const proposalsCollection = createCollection(
    electricCollectionOptions<Proposal>({
      id: `proposals-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'proposals', where } },
      getKey: (row: unknown) => (row as Proposal).id,
      onInsert: async ({ transaction }) => {
        const p = transaction.mutations[0].modified as Proposal;
        const result = await proposalsApi.create({
          id: p.id,
          organisation_id: orgId,
          topic_id: p.topic_id,
          title: p.title,
          description: p.description,
          closes_at: p.closes_at,
          opens_at: p.opens_at,
          deliberation_ends_at: p.deliberation_ends_at,
          threshold: p.threshold,
          status: p.status as 'open' | 'draft',
          proposal_type: p.proposal_type,
          anonymous_voting: p.anonymous_voting,
        });
        return { txid: result.txid };
      },
      onUpdate: async ({ transaction }) => {
        const p = transaction.mutations[0].modified as Proposal;
        const result = await proposalsApi.update(p.id, { title: p.title, description: p.description, status: p.status, closed_at: p.closed_at });
        return { txid: result.txid };
      },
      onDelete: async ({ transaction }) => {
        const p = transaction.mutations[0].original as Proposal;
        const result = await proposalsApi.delete(p.id);
        return { txid: result.txid };
      },
    }),
  );

  const delegationsCollection = createCollection(
    electricCollectionOptions<Delegation>({
      id: `delegations-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'delegations', where } },
      getKey: (row: unknown) => (row as Delegation).id,
      onInsert: async ({ transaction }) => {
        const d = transaction.mutations[0].modified as Delegation;
        const result = await delegationsApi.create({
          id: d.id,
          organisation_id: orgId,
          delegator_id: d.delegator_id,
          delegate_id: d.delegate_id,
          topic_id: d.topic_id,
          expires_at: d.expires_at ?? null,
        });
        return { txid: result.txid };
      },
      onDelete: async ({ transaction }) => {
        const d = transaction.mutations[0].original as Delegation;
        const result = await delegationsApi.delete(d.id);
        return { txid: result.txid };
      },
    }),
  );

  const votesCollection = createCollection(
    electricCollectionOptions<Vote>({
      id: `votes-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'votes', where } },
      getKey: (row: unknown) => (row as Vote).id,
      onInsert: async ({ transaction }) => {
        const v = transaction.mutations[0].modified as Vote;
        const result = await votesApi.create({ id: v.id, proposal_id: v.proposal_id, user_id: v.user_id, choice: v.choice, option_id: v.option_id, reason: v.reason });
        return { txid: result.txid };
      },
      onUpdate: async ({ transaction }) => {
        const v = transaction.mutations[0].modified as Vote;
        const result = await votesApi.update(v.id, { choice: v.choice, option_id: v.option_id, reason: v.reason });
        return { txid: result.txid };
      },
      onDelete: async ({ transaction }) => {
        const v = transaction.mutations[0].original as Vote;
        const result = await votesApi.delete(v.id);
        return { txid: result.txid };
      },
    }),
  );

  const commentsCollection = createCollection(
    electricCollectionOptions<Comment>({
      id: `comments-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'comments', where } },
      getKey: (row: unknown) => (row as Comment).id,
      onInsert: async ({ transaction }) => {
        const c = transaction.mutations[0].modified as Comment;
        const result = await commentsApi.create(c.proposal_id, { id: c.id, body: c.body, parent_comment_id: c.parent_comment_id ?? null });
        return { txid: result.txid };
      },
      onUpdate: async ({ transaction }) => {
        const c = transaction.mutations[0].modified as Comment;
        const result = await commentsApi.edit(c.id, c.body);
        return { txid: result.txid };
      },
      onDelete: async ({ transaction }) => {
        const c = transaction.mutations[0].original as Comment;
        const result = await commentsApi.delete(c.id);
        return { txid: result.txid };
      },
    }),
  );

  const commentReactionsCollection = createCollection(
    electricCollectionOptions<CommentReaction>({
      id: `comment_reactions-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'comment_reactions', where } },
      getKey: (row: unknown) => (row as CommentReaction).id,
      // Reactions are toggled via a dedicated API endpoint, not plain insert/delete
    }),
  );

  const argumentsCollection = createCollection(
    electricCollectionOptions<Argument>({
      id: `arguments-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'arguments', where } },
      getKey: (row: unknown) => (row as Argument).id,
      onInsert: async ({ transaction }) => {
        const a = transaction.mutations[0].modified as Argument;
        const result = await argumentsApi.create(a.proposal_id, { id: a.id, side: a.side, body: a.body });
        return { txid: result.txid };
      },
      onDelete: async ({ transaction }) => {
        const a = transaction.mutations[0].original as Argument;
        const result = await argumentsApi.delete(a.id);
        return { txid: result.txid };
      },
    }),
  );

  const proposalOptionsCollection = createCollection(
    electricCollectionOptions<ProposalOption>({
      id: `proposal_options-${orgId}`,
      shapeOptions: { url: shapeUrl, params: { table: 'proposal_options', where } },
      getKey: (row: unknown) => (row as ProposalOption).id,
      onInsert: async ({ transaction }) => {
        const o = transaction.mutations[0].modified as ProposalOption;
        const result = await proposalOptionsApi.create(o.proposal_id, { id: o.id, text: o.text, position: o.position });
        return { txid: (result as any).txid ?? 0 };
      },
      onDelete: async ({ transaction }) => {
        const o = transaction.mutations[0].original as ProposalOption;
        await proposalOptionsApi.delete(o.proposal_id, o.id);
        return { txid: 0 };
      },
    }),
  );

  return {
    topicsCollection,
    proposalsCollection,
    delegationsCollection,
    votesCollection,
    commentsCollection,
    commentReactionsCollection,
    argumentsCollection,
    proposalOptionsCollection,
  };
}
