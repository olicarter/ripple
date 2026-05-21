import { useState, useCallback, useEffect } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { Link, useNavigate } from '@tanstack/react-router';
import { usersCollection, membershipsCollection } from '../collections';
import { orgsApi, type User, type Membership, type Proposal, type Vote } from '../api';
import { formatDate } from '../utils/format';
import { useCurrentUser } from '../context';
import { useOrg } from '../OrgContext';
import { useToast } from '../components/Toast';
import { ConfirmButton } from '../components/ConfirmButton';
import { UserSearch } from '../components/UserSearch';
import { Button } from '../components/ui';
import styles from './MembersPage.module.css';

const ROLE_ORDER: Membership['role'][] = ['admin', 'moderator', 'member', 'observer'];

export function MembersPage() {
  const { org, collections: { proposalsCollection, votesCollection } } = useOrg();
  const currentUser = useCurrentUser();
  const addToast = useToast();
  const navigate = useNavigate();

  const { data: allUsers } = useLiveQuery(usersCollection);
  const { data: allMemberships } = useLiveQuery(membershipsCollection);
  const { data: allProposals } = useLiveQuery(proposalsCollection);
  const { data: allVotes } = useLiveQuery(votesCollection);

  const eligibleProposalCount = (allProposals ?? []).filter(
    (p: Proposal) => p.status !== 'draft',
  ).length;
  const votesByUser = new Map<string, Set<string>>();
  for (const v of (allVotes ?? []) as Vote[]) {
    if (!votesByUser.has(v.user_id)) votesByUser.set(v.user_id, new Set());
    votesByUser.get(v.user_id)!.add(v.proposal_id);
  }

  const orgMembers = (allMemberships ?? []).filter((m: Membership) => m.organisation_id === org.id);
  const myMembership = orgMembers.find((m: Membership) => m.user_id === currentUser?.id);
  const isAdmin = myMembership?.role === 'admin';

  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const [addRole, setAddRole] = useState<Membership['role']>('member');
  const [adding, setAdding] = useState(false);

  async function handleAdd() {
    if (!addingUserId) return;
    setAdding(true);
    try {
      await orgsApi.addMember(org.slug, { user_id: addingUserId, role: addRole });
      addToast('Member added', 'success');
      setAddingUserId(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add member', 'error');
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(userId: string, role: Membership['role']) {
    try {
      await orgsApi.updateMemberRole(org.slug, userId, role);
      addToast('Role updated', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update role', 'error');
    }
  }

  async function handleWeightChange(userId: string, weight: number) {
    if (isNaN(weight) || weight < 1 || weight > 100) return;
    try {
      await orgsApi.updateMemberWeight(org.slug, userId, weight);
      addToast('Vote weight updated', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update weight', 'error');
    }
  }

  async function handleRemove(userId: string) {
    try {
      await orgsApi.removeMember(org.slug, userId);
      addToast('Member removed', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove member', 'error');
    }
  }

  async function handleLeave() {
    if (!currentUser) return;
    try {
      await orgsApi.removeMember(org.slug, currentUser.id);
      addToast('You have left the organisation', 'info');
      // Use a hard navigation so the Electric cache is cleared before OrgListPage
      // auto-redirect logic runs, preventing a bounce back to this org.
      window.location.href = '/';
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to leave organisation', 'error');
    }
  }

  const [delegationWeights, setDelegationWeights] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    orgsApi.getDelegationWeights(org.slug).then((data) => {
      setDelegationWeights(new Map(data.map((d) => [d.user_id, d.carried_weight])));
    }).catch(() => {});
  }, [org.slug]);

  const [generatingToken, setGeneratingToken] = useState(false);
  const [revokingToken, setRevokingToken] = useState(false);

  const inviteUrl = org.invite_token
    ? `${window.location.origin}/orgs/${org.slug}/join?token=${org.invite_token}`
    : null;

  const handleGenerateToken = useCallback(async () => {
    setGeneratingToken(true);
    try {
      await orgsApi.generateInviteToken(org.slug);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to generate invite link', 'error');
    } finally {
      setGeneratingToken(false);
    }
  }, [org.slug, addToast]);

  const handleRevokeToken = useCallback(async () => {
    setRevokingToken(true);
    try {
      await orgsApi.revokeInviteToken(org.slug);
      addToast('Invite link revoked', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to revoke invite link', 'error');
    } finally {
      setRevokingToken(false);
    }
  }, [org.slug, addToast]);

  const handleCopyLink = useCallback(() => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl);
    addToast('Invite link copied', 'success');
  }, [inviteUrl, addToast]);

  const usersById = new Map<string, User>((allUsers ?? []).map((u: User) => [u.id, u]));
  const memberIds = new Set(orgMembers.map((m: Membership) => m.user_id));

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Members</h2>

      {isAdmin && (
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Invite link</h3>
          {inviteUrl ? (
            <div className={styles.inviteRow}>
              <input
                readOnly
                value={inviteUrl}
                className={styles.inviteInput}
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button size="sm" onClick={handleCopyLink}>Copy</Button>
              <ConfirmButton
                label={revokingToken ? 'Revoking…' : 'Revoke'}
                confirmLabel="Yes, revoke"
                onConfirm={handleRevokeToken}
                style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)', height: '28px', color: 'var(--color-error)', border: '1px solid var(--color-error-border)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                confirmStyle={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)' }}
              />
            </div>
          ) : (
            <Button size="sm" onClick={handleGenerateToken} disabled={generatingToken}>
              {generatingToken ? 'Generating…' : 'Generate invite link'}
            </Button>
          )}
        </div>
      )}

      {isAdmin && (
        <div className={styles.panel}>
          <h3 className={styles.panelTitle}>Add member</h3>
          <div className={styles.addRow}>
            <div className={styles.addSearchWrap}>
              <UserSearch
                users={(allUsers ?? []).filter((u: User) => !memberIds.has(u.id))}
                onSelect={(user: User) => setAddingUserId(user.id)}
                placeholder="Search users…"
              />
            </div>
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value as Membership['role'])}
              className={styles.roleSelect}
            >
              {ROLE_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <Button size="sm" onClick={handleAdd} disabled={!addingUserId || adding}>
              {adding ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </div>
      )}

      <div className={styles.memberList}>
        {orgMembers
          .sort((a: Membership, b: Membership) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
          .map((m: Membership) => {
            const user = usersById.get(m.user_id);
            const isMe = m.user_id === currentUser?.id;
            return (
              <div key={m.id} className={styles.memberRow}>
                <div>
                  <Link
                    to="/orgs/$slug/users/$id"
                    params={{ slug: org.slug, id: m.user_id }}
                    className={styles.memberName}
                  >
                    {user?.name ?? m.user_id}
                  </Link>
                  {isMe && <span className={styles.youLabel}>(you)</span>}
                  <div className={styles.memberMeta}>
                    {user?.email} · joined {formatDate(m.joined_at)}
                    {eligibleProposalCount > 0 && (() => {
                      const voted = votesByUser.get(m.user_id)?.size ?? 0;
                      const pct = Math.round((voted / eligibleProposalCount) * 100);
                      const cls = pct >= 70 ? styles.participationGood : pct >= 30 ? styles.participationMid : styles.participationLow;
                      return <span className={cls}> · {pct}% participation</span>;
                    })()}
                    {(() => {
                      const carried = delegationWeights.get(m.user_id);
                      const ownWeight = (m as { weight?: number }).weight ?? 1;
                      if (carried !== undefined && carried > ownWeight) {
                        return <span className={styles.carriedVotes}> · carries {carried} votes</span>;
                      }
                      return null;
                    })()}
                  </div>
                </div>
                <div className={styles.memberActions}>
                  {isAdmin && !isMe ? (
                    <>
                      <select
                        value={m.role}
                        onChange={(e) => handleRoleChange(m.user_id, e.target.value as Membership['role'])}
                        className={styles.roleSelect}
                      >
                        {ROLE_ORDER.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        defaultValue={m.weight ?? 1}
                        title="Vote weight"
                        aria-label="Vote weight"
                        onBlur={(e) => handleWeightChange(m.user_id, parseInt(e.target.value, 10))}
                        className={styles.weightInput}
                        data-testid="member-weight-input"
                      />
                      <ConfirmButton
                        label="Remove"
                        confirmLabel="Yes, remove"
                        onConfirm={() => handleRemove(m.user_id)}
                        style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', height: '26px', color: 'var(--color-error)', border: '1px solid var(--color-error-border)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                        confirmStyle={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)' }}
                      />
                    </>
                  ) : (
                    <>
                      <span className={`${styles.roleBadge} ${m.role === 'admin' ? styles.roleBadgeAdmin : styles.roleBadgeOther}`}>
                        {m.role}
                      </span>
                      {(m.weight ?? 1) > 1 && (
                        <span title={`Vote weight: ${m.weight}`} className={styles.weightBadge}>
                          ×{m.weight}
                        </span>
                      )}
                      {isMe && (
                        <ConfirmButton
                          label="Leave"
                          confirmLabel="Yes, leave"
                          onConfirm={handleLeave}
                          style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', height: '26px', color: 'var(--color-error)', border: '1px solid var(--color-error-border)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                          confirmStyle={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)' }}
                        />
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
