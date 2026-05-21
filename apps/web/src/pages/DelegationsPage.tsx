import { useState, useEffect } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { Link } from '@tanstack/react-router';
import { v4 as uuid } from 'uuid';
import { usersCollection, membershipsCollection } from '../collections';
import { useOrg } from '../OrgContext';
import { UserSearch } from '../components/UserSearch';
import { ConfirmButton } from '../components/ConfirmButton';
import { EmptyState } from '../components/EmptyState';
import { useCurrentUser } from '../context';
import { formatDate } from '../utils/format';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import { delegationsApi, type User, type Delegation, type Topic, type Membership, type DelegationHistoryEntry } from '../api';
import styles from './DelegationsPage.module.css';

export function DelegationsPage() {
  const currentUser = useCurrentUser();
  const { org, collections: { delegationsCollection, topicsCollection } } = useOrg();

  const { data: allDelegations } = useLiveQuery(delegationsCollection);
  const { data: allTopics } = useLiveQuery(topicsCollection);
  const { data: allUsers } = useLiveQuery(usersCollection);
  const { data: allMemberships } = useLiveQuery(membershipsCollection);

  const addToast = useToast();

  const [selectedDelegate, setSelectedDelegate] = useState<User | null>(null);
  const [scopeTopicId, setScopeTopicId] = useState<string>('__global__');
  const [expiresAt, setExpiresAt] = useState('');
  const [fallbackHours, setFallbackHours] = useState<string>('');
  const [weightPercent, setWeightPercent] = useState<string>('100');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [history, setHistory] = useState<DelegationHistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (currentUser) {
      delegationsApi.getHistory().then(setHistory).catch(() => {});
    }
  }, [currentUser?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!currentUser) {
    return (
      <div className={styles.page}>
        <h2 className={styles.heading}>Delegations</h2>
        <p className={styles.signIn}>Please sign in to manage your delegations.</p>
      </div>
    );
  }

  const outgoing = (allDelegations ?? []).filter(
    (d: Delegation) => d.delegator_id === currentUser.id,
  );
  const incoming = (allDelegations ?? []).filter(
    (d: Delegation) => d.delegate_id === currentUser.id,
  );

  const topicMap = Object.fromEntries((allTopics ?? []).map((t: Topic) => [t.id, t]));
  const userMap = Object.fromEntries((allUsers ?? []).map((u: User) => [u.id, u]));

  // Members who could be suggested as delegates (not self, not already globally delegated to)
  const alreadyDelegatedIds = new Set(
    outgoing.filter((d: Delegation) => d.topic_id === null).map((d: Delegation) => d.delegate_id),
  );
  const orgMemberUserIds = new Set(
    ((allMemberships ?? []) as Membership[])
      .filter((m) => m.organisation_id === org.id && m.status === 'approved' && m.user_id !== currentUser.id)
      .map((m) => m.user_id),
  );
  const suggestedDelegates = (allUsers ?? [])
    .filter((u: User) => orgMemberUserIds.has(u.id) && !alreadyDelegatedIds.has(u.id))
    .slice(0, 4) as User[];

  // Weight allocation per scope
  const allocationByScopeKey = (outgoing as Delegation[]).reduce((acc: Record<string, number>, d: Delegation) => {
    const key = d.topic_id ?? '__global__';
    acc[key] = (acc[key] ?? 0) + (Number(d.weight_fraction) || 1);
    return acc;
  }, {});

  // Total weight carried as delegate
  const incomingWeight = incoming.reduce((sum: number, d: Delegation) => sum + (Number(d.weight_fraction) || 1), 0);

  function scopeLabel(topicId: string | null) {
    if (!topicId) return 'Global';
    return topicMap[topicId]?.name ?? topicId;
  }

  function resetForm() {
    setSelectedDelegate(null);
    setScopeTopicId('__global__');
    setExpiresAt('');
    setFallbackHours('');
    setWeightPercent('100');
    setFormError('');
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!selectedDelegate) {
      setFormError('Please select a delegate.');
      return;
    }
    if (selectedDelegate.id === currentUser!.id) {
      setFormError('You cannot delegate to yourself.');
      return;
    }

    const resolvedTopicId = scopeTopicId === '__global__' ? null : scopeTopicId;
    const fraction = Math.min(100, Math.max(1, parseInt(weightPercent, 10) || 100)) / 100;

    const duplicate = outgoing.find((d: Delegation) => d.topic_id === resolvedTopicId && d.delegate_id === selectedDelegate.id);
    if (duplicate) {
      setFormError('You already have a delegation to this person for that scope.');
      return;
    }

    setSubmitting(true);
    try {
      const tx = delegationsCollection.insert({
        id: uuid(),
        organisation_id: org.id,
        delegator_id: currentUser!.id,
        delegate_id: selectedDelegate.id,
        topic_id: resolvedTopicId,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
        fallback_abstain_hours: fallbackHours ? parseInt(fallbackHours, 10) : null,
        weight_fraction: fraction,
        created_at: new Date().toISOString(),
      } as Delegation);
      await tx.isPersisted.promise;
      resetForm();
      setShowForm(false);
      addToast('Delegation added', 'success');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to add delegation.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(delegationId: string) {
    try {
      const tx = delegationsCollection.delete(delegationId);
      await tx.isPersisted.promise;
      addToast('Delegation removed', 'info');
    } catch {
      // ignore
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.heading}>Delegations</h2>
        <Link
          to="/orgs/$slug/delegations/network"
          params={{ slug: org.slug }}
          className={styles.networkLink}
        >
          View network graph →
        </Link>
      </div>

      {/* Explainer for first-time users */}
      {outgoing.length === 0 && !showForm && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: '1.25rem 1.5rem', marginBottom: '1.5rem', background: 'var(--color-bg-subtle)' }}>
          <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: 15 }}>What is delegation?</p>
          <p style={{ margin: '0 0 1rem', fontSize: 13, color: 'var(--color-fg-muted)', lineHeight: 1.5 }}>
            Delegation lets you hand your vote to someone you trust. If you haven't voted when a proposal closes, their vote counts on your behalf. You can always override by voting directly — your vote always takes priority.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => setShowForm(true)}>Delegate my vote</Button>
            {suggestedDelegates.slice(0, 3).map((u) => (
              <Button
                key={u.id}
                size="sm"
                variant="secondary"
                onClick={() => { setSelectedDelegate(u); setShowForm(true); }}
              >
                Delegate to {u.name.split(' ')[0]}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Outgoing delegations */}
      <section className={styles.section}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 className={styles.sectionHeading}>You are delegating to</h3>
          {outgoing.length > 0 && !showForm && (
            <Button size="sm" onClick={() => setShowForm(true)}>+ Add delegation</Button>
          )}
        </div>

        {outgoing.length === 0 ? (
          <EmptyState
            variant="delegations"
            title="No delegations set"
            description="Delegate your vote to someone you trust on all topics or a specific one."
          />
        ) : (
          <div className={styles.list}>
            {outgoing.map((d: Delegation) => {
              const delegate = userMap[d.delegate_id];
              const expired = d.expires_at ? new Date(d.expires_at) <= new Date() : false;
              const expiresDate = d.expires_at
                ? formatDate(d.expires_at)
                : null;
              const fraction = Number(d.weight_fraction) || 1;
              const pct = Math.round(fraction * 100);
              const scopeKey = d.topic_id ?? '__global__';
              const totalAlloc = allocationByScopeKey[scopeKey] ?? 1;
              const overAllocated = totalAlloc > 1.001;
              const rowClass = `${styles.delegationRow} ${expired ? styles.delegationRowExpired : ''} ${overAllocated ? styles.delegationRowOverAlloc : ''}`;
              return (
                <div key={d.id} className={rowClass}>
                  <div className={styles.delegationInfo}>
                    <span className={styles.delegateName}>{delegate?.name ?? d.delegate_id}</span>
                    {delegate?.email && <span className={styles.delegateEmail}>{delegate.email}</span>}
                    <span className={`${styles.scopeBadge} ${d.topic_id ? styles.scopeTopic : styles.scopeGlobal}`}>
                      {scopeLabel(d.topic_id)}
                    </span>
                    {pct !== 100 && (
                      <span className={styles.weightPct}>
                        {pct}% of vote
                        {overAllocated && <span className={styles.overAlloc}> · over-allocated</span>}
                      </span>
                    )}
                    {expired && <span className={styles.expired}>Expired</span>}
                    {!expired && expiresDate && <span className={styles.expiresDate}>expires {expiresDate}</span>}
                    {d.fallback_abstain_hours != null && (
                      <span className={styles.fallback}>voids if inactive {d.fallback_abstain_hours}h before deadline</span>
                    )}
                  </div>
                  <ConfirmButton
                    label="Remove"
                    confirmLabel="Yes, remove"
                    onConfirm={() => handleRemove(d.id)}
                    style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', height: '26px', color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                    confirmStyle={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)' }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Add delegation form */}
      {(showForm || outgoing.length === 0) && (
        <section className={styles.section}>
          <h3 className={styles.sectionHeading}>Add delegation</h3>
          <form className={styles.form} onSubmit={handleAdd}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Delegate to</label>
              {selectedDelegate ? (
                <div className={styles.selectedDelegate}>
                  <span>
                    <span className={styles.selectedDelegateName}>{selectedDelegate.name}</span>
                    <span className={styles.selectedDelegateEmail}>{selectedDelegate.email}</span>
                  </span>
                  <button type="button" onClick={() => setSelectedDelegate(null)} className={styles.clearBtn}>✕</button>
                </div>
              ) : (
                <div>
                  {suggestedDelegates.length > 0 && (
                    <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {suggestedDelegates.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setSelectedDelegate(u)}
                          style={{ fontSize: 12, padding: '3px 8px', border: '1px solid var(--color-border)', borderRadius: 20, background: 'var(--color-bg)', cursor: 'pointer', color: 'var(--color-fg)' }}
                        >
                          {u.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <UserSearch onSelect={setSelectedDelegate} excludeId={currentUser.id} />
                </div>
              )}
            </div>

            <div className={styles.formGrid}>
              <div>
                <label htmlFor="delegation-scope" className={styles.formLabel}>Scope</label>
                <select
                  id="delegation-scope"
                  value={scopeTopicId}
                  onChange={(e) => setScopeTopicId(e.target.value)}
                  className={styles.formSelect}
                >
                  <option value="__global__">Global (all topics)</option>
                  {(allTopics ?? []).map((t: Topic) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="delegation-expires-at" className={styles.formLabel}>
                  Expires <span className={styles.formLabelNote}>(optional)</span>
                </label>
                <input
                  id="delegation-expires-at"
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className={styles.formInput}
                />
              </div>
              <div>
                <label htmlFor="delegation-weight" className={styles.formLabel}>Weight %</label>
                <input
                  id="delegation-weight"
                  type="number"
                  min={1}
                  max={100}
                  value={weightPercent}
                  onChange={(e) => setWeightPercent(e.target.value)}
                  className={styles.formInput}
                />
              </div>
            </div>

            <div className={styles.formField}>
              <label htmlFor="delegation-fallback" className={styles.formLabel}>
                Conditional <span className={styles.formLabelNote}>(optional — void if delegate hasn't voted within N hours of deadline)</span>
              </label>
              <div className={styles.fallbackRow}>
                <input
                  id="delegation-fallback"
                  type="number"
                  min={1}
                  max={168}
                  value={fallbackHours}
                  onChange={(e) => setFallbackHours(e.target.value)}
                  placeholder="e.g. 48"
                  className={styles.formInput}
                  style={{ width: 80 }}
                />
                <span className={styles.fallbackHint}>hours before deadline</span>
              </div>
            </div>

            {formError && <p className={styles.formError}>{formError}</p>}

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <Button type="submit" disabled={submitting || !selectedDelegate} size="sm">
                {submitting ? 'Adding…' : 'Add delegation'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => { resetForm(); setShowForm(false); }}>
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Delegation history */}
      {history.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionHeading} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Delegation history</span>
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              style={{ fontSize: 'var(--text-xs)', fontWeight: 400, color: 'var(--color-fg-muted)', background: 'none', border: 'none', cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontFamily: 'var(--font-sans)' }}
            >
              {showHistory ? 'Hide' : `Show (${history.length})`}
            </button>
          </h3>
          {showHistory && (
            <div className={styles.list} style={{ gap: 'var(--space-1)' }}>
              {history.map((entry) => {
                const isOutgoing = entry.delegator_id === currentUser?.id;
                return (
                  <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)', padding: 'var(--space-2) 0', borderBottom: 'var(--border)' }}>
                    <span style={{
                      fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                      background: entry.event === 'added' ? 'var(--color-success-bg)' : 'var(--color-bg-muted)',
                      color: entry.event === 'added' ? 'var(--color-success)' : 'var(--color-fg-subtle)',
                      border: entry.event === 'added' ? '1px solid var(--color-success-border)' : 'var(--border)',
                      whiteSpace: 'nowrap',
                    }}>
                      {entry.event}
                    </span>
                    <span>
                      {isOutgoing
                        ? <>You delegated to <strong style={{ color: 'var(--color-fg)' }}>{entry.delegate_name}</strong></>
                        : <><strong style={{ color: 'var(--color-fg)' }}>{entry.delegator_name}</strong> delegated to you</>
                      }
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                      {new Date(entry.created_at).toLocaleDateString()}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Incoming (trust received) */}
      <section className={styles.section}>
        <h3 className={styles.sectionHeading}>
          Delegated to you
          {incoming.length > 0 && (
            <span style={{ fontWeight: 400, marginLeft: '0.5rem', textTransform: 'none', letterSpacing: 0, color: 'var(--color-fg-muted)', fontSize: 12 }}>
              — you carry {incoming.length} vote{incoming.length !== 1 ? 's' : ''}{incomingWeight !== incoming.length ? ` (${Math.round(incomingWeight * 100) / 100}× weight)` : ''}
            </span>
          )}
        </h3>
        {incoming.length === 0 ? (
          <EmptyState variant="delegations" title="Nobody has delegated to you yet" />
        ) : (
          <div className={styles.list}>
            {incoming.map((d: Delegation) => {
              const delegator = userMap[d.delegator_id];
              return (
                <div key={d.id} className={styles.delegationRow}>
                  <div className={styles.delegationInfo}>
                    <span className={styles.delegateName}>{delegator?.name ?? d.delegator_id}</span>
                    {delegator?.email && <span className={styles.delegateEmail}>{delegator.email}</span>}
                    <span className={`${styles.scopeBadge} ${d.topic_id ? styles.scopeTopic : styles.scopeGlobal}`}>
                      {scopeLabel(d.topic_id)}
                    </span>
                    {Number(d.weight_fraction) !== 1 && (
                      <span className={styles.weightPct}>{Math.round(Number(d.weight_fraction) * 100)}% of their vote</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
