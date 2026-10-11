import type { Organisation, Proposal } from '../api';

/**
 * Whether other members' votes on this proposal are withheld from the synced
 * votes collection: anonymous proposals always, and open proposals in orgs that
 * hide votes until close. Mirrors the server rule in
 * apps/api/src/electric/shape-policy.ts — the collection then only holds the
 * viewer's own vote for such proposals, so counts must come from the tally API.
 */
export function votesArePrivate(
  proposal: Pick<Proposal, 'anonymous_voting' | 'status'>,
  org: Pick<Organisation, 'voting_visibility'>,
): boolean {
  return !!proposal.anonymous_voting || (org.voting_visibility === 'hidden' && proposal.status === 'open');
}
