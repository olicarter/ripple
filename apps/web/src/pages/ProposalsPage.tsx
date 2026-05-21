import { useState, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useLiveQuery } from '@tanstack/react-db';
import { v4 as uuid } from 'uuid';
import { usersCollection, membershipsCollection } from '../collections';
import { useOrg } from '../OrgContext';
import { useCurrentUser } from '../context';
import { useToast } from '../components/Toast';
import { EmptyState } from '../components/EmptyState';
import { Button } from '../components/ui';
import { proposalOptionsApi, aiApi } from '../api';
import type { Topic, Proposal, Vote, User, Comment, Membership } from '../api';
import styles from './ProposalsPage.module.css';

const TITLE_MAX = 200;
const DESC_MAX = 10000;

function toLocalDatetimeString(date: Date): string {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatDeadline(closesAt: string): { label: string; urgent: boolean } {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Closing soon', urgent: true };
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);
  if (minutes < 60) return { label: `${minutes}m left`, urgent: true };
  if (hours < 24) return { label: `${hours}h left`, urgent: hours < 6 };
  return { label: `${days}d left`, urgent: false };
}

function computeResult(yes: number, no: number, threshold: number): 'passed' | 'failed' | 'no-votes' {
  if (yes + no === 0) return 'no-votes';
  return (yes / (yes + no)) * 100 >= threshold ? 'passed' : 'failed';
}

function ProposalSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonLine} style={{ width: '55%', height: 14, marginBottom: 8 }} />
      <div className={styles.skeletonLine} style={{ width: '85%', height: 11, marginBottom: 6 }} />
      <div className={styles.skeletonLine} style={{ width: '30%', height: 11 }} />
    </div>
  );
}

const ROLE_RANK: Record<string, number> = { member: 1, moderator: 2, admin: 3 };

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
  standard: 'Vote',
  discussion: 'Discussion',
  multiple_choice: 'Multiple choice',
  temperature_check: 'Temp check',
  consent: 'Consent',
  approval: 'Approval',
  score_voting: 'Score',
  ranked_choice: 'Ranked choice',
  petition: 'Petition',
  amendment: 'Amendment',
};

const PROPOSAL_TYPE_HINTS: Partial<Record<string, string>> = {
  discussion: 'No formal vote — members comment and deliberate only.',
  multiple_choice: 'Members pick one option. Add at least 2 options below.',
  approval: 'Members approve as many options as they like. Most-approved wins.',
  score_voting: 'Members rate each option 0–5. Highest mean score wins.',
  ranked_choice: 'Members rank options in order of preference. Instant-runoff determines the winner.',
  temperature_check: 'Non-binding straw poll to gauge sentiment before a formal vote.',
  consent: 'Passes unless someone raises a paramount objection. Good for consensus-oriented groups.',
  petition: 'Collects signatures. Automatically transitions to a standard vote when threshold is reached.',
};

export function ProposalsPage() {
  const currentUser = useCurrentUser();
  const addToast = useToast();
  const { org, collections: { proposalsCollection, topicsCollection, votesCollection, commentsCollection } } = useOrg();
  const { data: allProposals } = useLiveQuery(proposalsCollection);
  const { data: allTopics } = useLiveQuery(topicsCollection);
  const { data: allVotes } = useLiveQuery(votesCollection);
  const { data: allUsers } = useLiveQuery(usersCollection);
  const { data: allComments } = useLiveQuery(commentsCollection);
  const { data: allMemberships } = useLiveQuery(membershipsCollection);

  const myMembership = currentUser
    ? (allMemberships ?? []).find((m: Membership) => m.organisation_id === org.id && m.user_id === currentUser.id)
    : undefined;
  const canCreateProposal = myMembership
    ? (ROLE_RANK[myMembership.role] ?? 0) >= (ROLE_RANK[org.proposal_creation_role ?? 'member'] ?? 1)
    : false;
  const canCreateTopic = myMembership
    ? (ROLE_RANK[myMembership.role] ?? 0) >= (ROLE_RANK[org.topic_creation_role ?? 'member'] ?? 1)
    : false;

  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [mineFilter, setMineFilter] = useState<'mine' | 'voted' | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<'newest' | 'oldest' | 'most-votes'>('newest');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [topicId, setTopicId] = useState('');
  const [newTopicName, setNewTopicName] = useState('');
  const [closesAt, setClosesAt] = useState(() => {
    const days = org.default_voting_duration_days;
    if (!days) return '';
    const d = new Date(Date.now() + days * 86400000);
    const offset = d.getTimezoneOffset();
    return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
  });
  const [threshold, setThreshold] = useState(org.default_threshold ?? 50);
  const THRESHOLD_PRESETS = [
    { label: 'Simple majority', value: 50 },
    { label: 'Two-thirds', value: 67 },
    { label: 'Three-quarters', value: 75 },
  ];
  const [deliberationEndsAt, setDeliberationEndsAt] = useState('');
  const [quorum, setQuorum] = useState<number | null>(org.default_quorum ?? null);
  const [quorumType, setQuorumType] = useState<'soft' | 'hard'>('soft');
  const [impactLevel, setImpactLevel] = useState<'low' | 'medium' | 'high' | 'constitutional' | null>(null);
  const [proposalType, setProposalType] = useState<'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent' | 'approval' | 'score_voting' | 'ranked_choice' | 'petition'>('standard');
  const [signatureThreshold, setSignatureThreshold] = useState<string>('');
  const [mcOptions, setMcOptions] = useState<string[]>(['', '']);
  const [anonymousVoting, setAnonymousVoting] = useState(false);
  const [convictionVoting, setConvictionVoting] = useState(false);
  const [quadraticVoting, setQuadraticVoting] = useState(false);
  const [opensAt, setOpensAt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [nlDraftInput, setNlDraftInput] = useState('');
  const [draftingProposal, setDraftingProposal] = useState(false);
  const [showNlDraft, setShowNlDraft] = useState(false);

  const myVotedProposalIds = currentUser
    ? new Set((allVotes ?? []).filter((v: Vote) => v.user_id === currentUser.id).map((v: Vote) => v.proposal_id))
    : new Set<string>();

  const allTags = [...new Set((allProposals ?? []).flatMap((p: Proposal) => p.tags ?? []))].sort();

  const proposals = (allProposals ?? [])
    .filter((p: Proposal) => {
      if (topicFilter !== null && p.topic_id !== topicFilter) return false;
      if (p.status === 'draft' && p.author_id !== currentUser?.id) return false;
      if (statusFilter !== null && p.status !== statusFilter) return false;
      if (mineFilter === 'mine' && p.author_id !== currentUser?.id) return false;
      if (mineFilter === 'voted' && !myVotedProposalIds.has(p.id)) return false;
      if (tagFilter !== null && !(p.tags ?? []).includes(tagFilter)) return false;
      if (search && !p.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a: Proposal, b: Proposal) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (sort === 'oldest') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      if (sort === 'most-votes') {
        const aVotes = (allVotes ?? []).filter((v: Vote) => v.proposal_id === a.id).length;
        const bVotes = (allVotes ?? []).filter((v: Vote) => v.proposal_id === b.id).length;
        return bVotes - aVotes;
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const topicMap = Object.fromEntries((allTopics ?? []).map((t: Topic) => [t.id, t]));
  const userMap = Object.fromEntries((allUsers ?? []).map((u: User) => [u.id, u]));

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: proposals.length,
    estimateSize: () => 100,
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  function resetForm() {
    setTitle('');
    setDescription('');
    setTopicId('');
    setNewTopicName('');
    const days = org.default_voting_duration_days;
    if (days) {
      const d = new Date(Date.now() + days * 86400000);
      const offset = d.getTimezoneOffset();
      setClosesAt(new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16));
    } else {
      setClosesAt('');
    }
    setDeliberationEndsAt('');
    setThreshold(org.default_threshold ?? 50);
    setQuorum(org.default_quorum ?? null);
    setQuorumType('soft');
    setImpactLevel(null);
    setProposalType('standard');
    setMcOptions(['', '']);
    setAnonymousVoting(false);
    setConvictionVoting(false);
    setQuadraticVoting(false);
    setOpensAt('');
    setShowForm(false);
    setFormError('');
  }

  async function handleCreate(asDraft = false) {
    if (!currentUser) return;
    setFormError('');

    if (!title.trim()) {
      setFormError('Title is required.');
      return;
    }
    if (title.trim().length < 3) {
      setFormError('Title must be at least 3 characters.');
      return;
    }

    setSubmitting(true);
    try {
      let resolvedTopicId = topicId;

      if (topicId === '__new__') {
        const name = newTopicName.trim();
        if (!name) {
          setFormError('Topic name is required.');
          setSubmitting(false);
          return;
        }
        resolvedTopicId = uuid();
        const topicTx = topicsCollection.insert({
          id: resolvedTopicId,
          organisation_id: org.id,
          name,
          description: '',
          created_at: new Date().toISOString(),
        } as Topic);
        await topicTx.isPersisted.promise;
      }

      if (!resolvedTopicId) {
        setFormError('Please select a topic.');
        setSubmitting(false);
        return;
      }

      const proposalId = uuid();
      const needsOptions = ['multiple_choice', 'approval', 'score_voting', 'ranked_choice'].includes(proposalType);
      if (needsOptions) {
        const validOpts = mcOptions.map((o) => o.trim()).filter(Boolean);
        if (validOpts.length < 2) {
          setFormError('This proposal type needs at least 2 options.');
          setSubmitting(false);
          return;
        }
      }
      if (proposalType === 'petition' && !signatureThreshold) {
        setFormError('Please set a signature threshold for petition mode.');
        setSubmitting(false);
        return;
      }
      const noDeadline = proposalType === 'discussion';
      const proposalTx = proposalsCollection.insert({
        id: proposalId,
        organisation_id: org.id,
        topic_id: resolvedTopicId,
        author_id: currentUser.id,
        title: title.trim(),
        description: description.trim(),
        status: asDraft ? 'draft' : 'open',
        proposal_type: proposalType,
        threshold,
        quorum,
        quorum_type: quorumType,
        impact_level: impactLevel,
        signature_threshold: proposalType === 'petition' ? parseInt(signatureThreshold, 10) : null,
        created_at: new Date().toISOString(),
        closes_at: noDeadline ? null : (closesAt ? new Date(closesAt).toISOString() : null),
        opens_at: opensAt ? new Date(opensAt).toISOString() : null,
        deliberation_ends_at: noDeadline ? null : (deliberationEndsAt ? new Date(deliberationEndsAt).toISOString() : null),
        closed_at: null,
        anonymous_voting: anonymousVoting,
        conviction_voting: convictionVoting,
        quadratic_voting: quadraticVoting,
      } as Proposal);
      await proposalTx.isPersisted.promise;
      if (needsOptions) {
        const validOpts = mcOptions.map((o) => o.trim()).filter(Boolean);
        await Promise.all(validOpts.map((text, i) =>
          proposalOptionsApi.create(proposalId, { id: uuid(), text, position: i }),
        ));
      }

      addToast(asDraft ? 'Draft saved' : 'Proposal created');
      resetForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create proposal.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Proposals</h1>
        {canCreateProposal && (
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New proposal'}
          </Button>
        )}
      </div>

      {showForm && canCreateProposal && (
        <form onSubmit={(e) => { e.preventDefault(); handleCreate(false); }} className={styles.form}>
          <div className={styles.formHeader}>
            <span className={styles.formTitle}>New proposal</span>
            {((org as { proposal_templates?: unknown[] }).proposal_templates ?? []).length > 0 && (
              <select
                data-testid="use-template-select"
                defaultValue=""
                onChange={(e) => {
                  const tmplId = e.target.value;
                  if (!tmplId) return;
                  const templates = (org as { proposal_templates?: Array<{ id: string; name: string; description: string; proposal_type: 'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent'; threshold: number }> }).proposal_templates ?? [];
                  const tmpl = templates.find((t) => t.id === tmplId);
                  if (!tmpl) return;
                  setDescription(tmpl.description);
                  setProposalType(tmpl.proposal_type);
                  setThreshold(tmpl.threshold);
                  e.target.value = '';
                }}
                className={styles.formSelect}
                style={{ width: 'auto' }}
              >
                <option value="">Use template…</option>
                {((org as { proposal_templates?: Array<{ id: string; name: string }> }).proposal_templates ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* AI draft */}
          {showNlDraft ? (
            <div style={{ marginBottom: '1rem', padding: '0.75rem', border: '1px solid #eee', borderRadius: 6, background: '#fafafa' }}>
              <label style={{ fontSize: 13, color: '#555', display: 'block', marginBottom: '0.4rem' }}>Describe what you want to propose</label>
              <textarea
                value={nlDraftInput}
                onChange={(e) => setNlDraftInput(e.target.value)}
                placeholder="e.g. I want to propose we reduce the working week to 4 days for all staff, maintaining current pay..."
                rows={3}
                style={{ width: '100%', padding: '0.4rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', resize: 'vertical', marginBottom: '0.5rem' }}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  disabled={draftingProposal || !nlDraftInput.trim()}
                  onClick={async () => {
                    setDraftingProposal(true);
                    try {
                      const draft = await aiApi.draftProposal(nlDraftInput);
                      setTitle(draft.title);
                      setDescription(draft.description);
                      setProposalType(draft.suggested_type);
                      setThreshold(draft.suggested_threshold);
                      setShowNlDraft(false);
                      setNlDraftInput('');
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Failed to draft proposal', 'error');
                    } finally {
                      setDraftingProposal(false);
                    }
                  }}
                  style={{ fontSize: 12, padding: '0.3rem 0.8rem', background: '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                >
                  {draftingProposal ? 'Drafting…' : 'Draft proposal'}
                </button>
                <button type="button" onClick={() => { setShowNlDraft(false); setNlDraftInput(''); }} style={{ fontSize: 12, padding: '0.3rem 0.8rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#888' }}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginBottom: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setShowNlDraft(true)}
                style={{ fontSize: 12, padding: '0.2rem 0.6rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#888' }}
              >
                &#10022; Draft with AI
              </button>
            </div>
          )}

          <div className={styles.formField} style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label htmlFor="new-proposal-title" className={styles.formLabel}>Title</label>
              {title.length > TITLE_MAX - 40 && (
                <span className={`${styles.charCount} ${title.length >= TITLE_MAX ? styles.charCountError : styles.charCountWarning}`}>
                  {TITLE_MAX - title.length} left
                </span>
              )}
            </div>
            <input
              id="new-proposal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              maxLength={TITLE_MAX}
              className={styles.formInput}
            />
          </div>

          <div className={styles.formField} style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label htmlFor="new-proposal-description" className={styles.formLabel}>
                Description <span className={styles.formLabelNote}>(Markdown supported)</span>
              </label>
              {description.length > DESC_MAX - 500 && (
                <span className={`${styles.charCount} ${description.length >= DESC_MAX ? styles.charCountError : styles.charCountWarning}`}>
                  {DESC_MAX - description.length} left
                </span>
              )}
            </div>
            <textarea
              id="new-proposal-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
              rows={3}
              maxLength={DESC_MAX}
              className={styles.formTextarea}
            />
          </div>

          <div className={styles.formField} style={{ marginBottom: 'var(--space-3)' }}>
            <label htmlFor="new-proposal-topic" className={styles.formLabel}>Topic</label>
            <select
              id="new-proposal-topic"
              value={topicId}
              onChange={(e) => setTopicId(e.target.value)}
              required
              className={styles.formSelect}
            >
              <option value="">Select a topic…</option>
              {(allTopics ?? []).map((t: Topic) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
              {canCreateTopic && <option value="__new__">＋ New topic…</option>}
            </select>
          </div>

          {topicId === '__new__' && (
            <div className={styles.formField} style={{ marginBottom: 'var(--space-3)' }}>
              <label htmlFor="new-topic-name" className={styles.formLabel}>New topic name</label>
              <input
                id="new-topic-name"
                type="text"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                className={styles.formInput}
              />
            </div>
          )}

          <div className={styles.formField} style={{ marginBottom: 'var(--space-4)' }}>
            <span className={styles.formLabel}>Proposal type</span>
            <div className={styles.typePills}>
              {([
                'standard', 'multiple_choice', 'approval', 'score_voting',
                'ranked_choice', 'temperature_check', 'consent', 'petition', 'discussion',
              ] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`proposal-type-${value}`}
                  onClick={() => setProposalType(value)}
                  className={`${styles.typePill} ${proposalType === value ? styles.typePillActive : ''}`}
                >
                  {PROPOSAL_TYPE_LABELS[value]}
                </button>
              ))}
            </div>
            {PROPOSAL_TYPE_HINTS[proposalType] && (
              <p className={styles.formHint}>{PROPOSAL_TYPE_HINTS[proposalType]}</p>
            )}
          </div>

          {proposalType === 'petition' && (
            <div className={styles.formField} style={{ marginBottom: 'var(--space-4)' }}>
              <label htmlFor="signature-threshold" className={styles.formLabel}>
                Signature threshold <span className={styles.formLabelNote}>(transitions to vote when reached)</span>
              </label>
              <input
                id="signature-threshold"
                type="number"
                min={1}
                value={signatureThreshold}
                onChange={(e) => setSignatureThreshold(e.target.value)}
                placeholder="e.g. 10"
                className={styles.formInput}
                style={{ width: 100 }}
              />
            </div>
          )}

          {(['multiple_choice', 'approval', 'score_voting', 'ranked_choice'] as const).includes(proposalType as never) && (
            <div className={styles.formField} style={{ marginBottom: 'var(--space-4)' }}>
              <span className={styles.formLabel}>Options</span>
              {mcOptions.map((opt, i) => (
                <div key={i} className={styles.optionRow}>
                  <input
                    data-testid={`mc-option-${i}`}
                    type="text"
                    value={opt}
                    onChange={(e) => setMcOptions((prev) => prev.map((o, j) => j === i ? e.target.value : o))}
                    placeholder={`Option ${i + 1}`}
                    maxLength={500}
                    className={styles.formInput}
                  />
                  {mcOptions.length > 2 && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => setMcOptions((prev) => prev.filter((_, j) => j !== i))}
                    >×</Button>
                  )}
                </div>
              ))}
              {mcOptions.length < 8 && (
                <button
                  type="button"
                  data-testid="mc-add-option"
                  onClick={() => setMcOptions((prev) => [...prev, ''])}
                  style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 'var(--space-1)', fontFamily: 'var(--font-sans)' }}
                >+ Add option</button>
              )}
            </div>
          )}

          {proposalType !== 'discussion' && (
            <>
              <div className={styles.formGrid} style={{ marginBottom: 'var(--space-4)' }}>
                <div className={styles.formField}>
                  <label htmlFor="new-proposal-deliberation-ends-at" className={styles.formLabel}>
                    Deliberation ends <span className={styles.formLabelNote}>(optional)</span>
                  </label>
                  <input
                    id="new-proposal-deliberation-ends-at"
                    type="datetime-local"
                    value={deliberationEndsAt}
                    onChange={(e) => setDeliberationEndsAt(e.target.value)}
                    min={toLocalDatetimeString(new Date())}
                    className={styles.formInput}
                  />
                  <p className={styles.formHint}>Discussion only until this time.</p>
                </div>
                <div className={styles.formField}>
                  <label htmlFor="new-proposal-closes-at" className={styles.formLabel}>
                    Voting deadline <span className={styles.formLabelNote}>(optional)</span>
                  </label>
                  <input
                    id="new-proposal-closes-at"
                    type="datetime-local"
                    value={closesAt}
                    onChange={(e) => setClosesAt(e.target.value)}
                    min={deliberationEndsAt || toLocalDatetimeString(new Date())}
                    className={styles.formInput}
                  />
                </div>
                <div className={styles.formField}>
                  <label htmlFor="new-proposal-opens-at" className={styles.formLabel}>
                    Scheduled open <span className={styles.formLabelNote}>(optional — publish later)</span>
                  </label>
                  <input
                    id="new-proposal-opens-at"
                    type="datetime-local"
                    value={opensAt}
                    onChange={(e) => setOpensAt(e.target.value)}
                    min={toLocalDatetimeString(new Date())}
                    className={styles.formInput}
                  />
                  {opensAt && <p className={styles.formHint}>Proposal will be saved as draft and open automatically at this time.</p>}
                </div>
                <div className={styles.formField}>
                  <label htmlFor="new-proposal-threshold" className={styles.formLabel}>Passing threshold</label>
                  <div className={styles.presetPills}>
                    {THRESHOLD_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => setThreshold(p.value)}
                        className={`${styles.presetPill} ${threshold === p.value ? styles.presetPillActive : ''}`}
                      >
                        {p.label} ({p.value}%)
                      </button>
                    ))}
                    <div className={styles.thresholdRow}>
                      <input
                        id="new-proposal-threshold"
                        type="number"
                        value={threshold}
                        onChange={(e) => setThreshold(Math.min(100, Math.max(1, parseInt(e.target.value) || 50)))}
                        min={1}
                        max={100}
                        className={styles.thresholdInput}
                      />
                      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>% yes</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.formField} style={{ marginBottom: 'var(--space-4)' }}>
                <label htmlFor="new-proposal-quorum" className={styles.formLabel}>
                  Quorum <span className={styles.formLabelNote}>(optional — % of members who must participate)</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <input
                      id="new-proposal-quorum"
                      type="number"
                      value={quorum ?? ''}
                      onChange={(e) => setQuorum(e.target.value === '' ? null : Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
                      min={1}
                      max={100}
                      placeholder="e.g. 50"
                      className={styles.formInput}
                      style={{ width: 80 }}
                    />
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>%</span>
                  </div>
                  {quorum !== null && (
                    <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
                      {(['soft', 'hard'] as const).map((qt) => (
                        <label key={qt} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-base)', cursor: 'pointer', color: 'var(--color-fg-muted)' }}>
                          <input type="radio" name="quorum_type" value={qt} checked={quorumType === qt} onChange={() => setQuorumType(qt)} />
                          {qt === 'soft' ? 'Soft (advisory)' : 'Hard (auto-fail)'}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {quorum !== null && (
                <div className={styles.formField} style={{ marginBottom: 'var(--space-4)' }}>
                  <span className={styles.formLabel}>
                    Impact level <span className={styles.formLabelNote}>(optional — scales quorum requirement)</span>
                  </span>
                  <div className={styles.typePills}>
                    {([null, 'low', 'medium', 'high', 'constitutional'] as const).map((level) => {
                      const multipliers: Record<string, string> = { low: '×0.5', medium: '×1.0', high: '×1.5', constitutional: '×2.0' };
                      return (
                        <button
                          key={level ?? 'none'}
                          type="button"
                          onClick={() => setImpactLevel(level)}
                          className={`${styles.typePill} ${impactLevel === level ? styles.typePillActive : ''}`}
                        >
                          {level === null ? 'None' : `${level.charAt(0).toUpperCase() + level.slice(1)} (${multipliers[level]})`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {proposalType !== 'discussion' && (
            <div className={styles.formField} style={{ marginBottom: 'var(--space-4)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={anonymousVoting}
                  onChange={(e) => setAnonymousVoting(e.target.checked)}
                />
                <span className={styles.formLabel} style={{ margin: 0 }}>Anonymous voting</span>
              </label>
              <p className={styles.formHint}>Voter identities will not be shown to anyone, including admins.</p>
            </div>
          )}

          {proposalType === 'standard' && (
            <div className={styles.formGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={convictionVoting}
                  onChange={(e) => setConvictionVoting(e.target.checked)}
                />
                <span className={styles.formLabel} style={{ margin: 0 }}>Conviction voting</span>
              </label>
              <p className={styles.formHint}>Vote weight grows with time — the longer a vote is held without changing, the more conviction it carries.</p>
            </div>
          )}

          {proposalType === 'standard' && (
            <div className={styles.formGroup}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={quadraticVoting}
                  onChange={(e) => setQuadraticVoting(e.target.checked)}
                />
                <span className={styles.formLabel} style={{ margin: 0 }}>Quadratic voting</span>
              </label>
              <p className={styles.formHint}>Members spend credits to cast multiple votes on the same option — casting K votes costs K² credits, so influence scales with the square root of credits spent.</p>
            </div>
          )}

          {formError && <p className={styles.formError}>{formError}</p>}
          <div className={styles.formActions}>
            <Button type="submit" disabled={submitting} size="sm">
              {submitting ? 'Creating…' : 'Create proposal'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleCreate(true)}
              disabled={submitting}
            >
              Save as draft
            </Button>
          </div>
        </form>
      )}

      <div className={styles.toolbar}>
        <input
          type="search"
          placeholder="Search proposals…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={styles.searchInput}
        />
        <select
          aria-label="Sort proposals"
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className={styles.sortSelect}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="most-votes">Most votes</option>
        </select>
      </div>

      <div className={styles.filters}>
        <button
          onClick={() => setTopicFilter(null)}
          className={`${styles.filterPill} ${topicFilter === null ? styles.filterPillActive : ''}`}
        >
          All topics
        </button>
        {(allTopics ?? []).map((t: Topic) => (
          <button
            key={t.id}
            onClick={() => setTopicFilter(topicFilter === t.id ? null : t.id)}
            className={`${styles.filterPill} ${topicFilter === t.id ? styles.filterPillActive : ''}`}
          >
            {t.name}
          </button>
        ))}
      </div>

      <div className={styles.filters}>
        {([null, 'open', 'closed', 'withdrawn'] as const).map((s) => {
          const label = s === null ? 'All' : s.charAt(0).toUpperCase() + s.slice(1);
          return (
            <button
              key={String(s)}
              onClick={() => setStatusFilter(s)}
              className={`${styles.filterPill} ${statusFilter === s ? styles.filterPillActive : ''}`}
            >
              {label}
            </button>
          );
        })}
        {currentUser && (
          <>
            <button
              onClick={() => setMineFilter(mineFilter === 'mine' ? null : 'mine')}
              className={`${styles.filterPill} ${mineFilter === 'mine' ? styles.filterPillActive : ''}`}
            >
              Mine
            </button>
            <button
              onClick={() => setMineFilter(mineFilter === 'voted' ? null : 'voted')}
              className={`${styles.filterPill} ${mineFilter === 'voted' ? styles.filterPillActive : ''}`}
            >
              Voted
            </button>
          </>
        )}
      </div>

      {allTags.length > 0 && (
        <div className={styles.filters} style={{ marginBottom: 'var(--space-5)' }}>
          {allTags.map((tag: unknown) => (
            <button
              key={tag as string}
              data-testid={`tag-filter-${tag}`}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag as string)}
              className={`${styles.filterPill} ${tagFilter === tag ? styles.filterPillActive : ''}`}
            >
              {tag as string}
            </button>
          ))}
        </div>
      )}

      {allProposals === null ? (
        <div className={styles.list}>
          <ProposalSkeleton />
          <ProposalSkeleton />
          <ProposalSkeleton />
        </div>
      ) : proposals.length === 0 ? (
        topicFilter !== null || statusFilter !== null || mineFilter !== null || tagFilter !== null || search ? (
          <EmptyState variant="proposals" title="No proposals match these filters" description="Try adjusting your filters or search term." />
        ) : (
          <EmptyState variant="proposals" title="No proposals yet" description={currentUser ? 'Be the first to start a discussion.' : 'Sign in to create the first proposal.'} />
        )
      ) : (
        <div
          ref={listRef}
          className={styles.list}
          style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}
        >
          {virtualizer.getVirtualItems().map((vItem) => {
            const p = proposals[vItem.index] as Proposal;
            const topic = topicMap[p.topic_id];
            const author = p.author_id ? userMap[p.author_id] : undefined;
            const votes = (allVotes ?? []).filter((v: Vote) => v.proposal_id === p.id);
            const yes = votes.filter((v: Vote) => v.choice === 'yes').length;
            const no = votes.filter((v: Vote) => v.choice === 'no').length;
            const abstain = votes.filter((v: Vote) => v.choice === 'abstain').length;
            const commentCount = (allComments ?? []).filter((c: Comment) => c.proposal_id === p.id).length;
            const myVote = currentUser ? votes.find((v: Vote) => v.user_id === currentUser.id) : undefined;

            const isDraft = p.status === 'draft';
            const isOpen = p.status === 'open';
            const isWithdrawn = p.status === 'withdrawn';
            const isDeliberating = isOpen && !!p.deliberation_ends_at && new Date(p.deliberation_ends_at as string) > new Date();
            const deadline = isOpen && p.closes_at ? formatDeadline(p.closes_at) : null;
            const result = p.status === 'closed' ? computeResult(yes, no, p.threshold ?? 50) : null;

            const cardCls = [
              styles.cardInner,
              isDraft ? styles.cardDraft : '',
              p.pinned ? styles.cardPinned : '',
            ].filter(Boolean).join(' ');

            return (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vItem.start - virtualizer.options.scrollMargin}px)`,
                  paddingBottom: 'var(--space-2)',
                }}
              >
              <Link
                to="/orgs/$slug/proposals/$id"
                params={{ slug: org.slug, id: p.id }}
                className={styles.card}
              >
                <div className={cardCls}>
                  <div className={styles.cardRow}>
                    <div className={styles.cardBody}>
                      <p className={styles.cardTitle}>
                        {p.pinned && <span className={styles.pinIcon} aria-label="Pinned">📌</span>}
                        {p.title}
                      </p>
                      {p.description && (
                        <p className={styles.cardDescription}>{p.description}</p>
                      )}
                      <div className={styles.cardMeta}>
                        {topic && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-muted)', color: 'var(--color-fg-muted)', border: 'var(--border)', whiteSpace: 'nowrap' }}>
                            {topic.name}
                          </span>
                        )}
                        {p.proposal_type && p.proposal_type !== 'standard' && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-muted)', color: 'var(--color-fg-muted)', border: 'var(--border)', whiteSpace: 'nowrap' }}>
                            {PROPOSAL_TYPE_LABELS[p.proposal_type] ?? p.proposal_type}
                          </span>
                        )}
                        {isDraft && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: '1px solid var(--color-warning-border)', whiteSpace: 'nowrap' }}>
                            Draft
                          </span>
                        )}
                        {result === 'passed' && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)', whiteSpace: 'nowrap' }}>Passed</span>
                        )}
                        {result === 'failed' && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-error-bg)', color: 'var(--color-error)', border: '1px solid var(--color-error-border)', whiteSpace: 'nowrap' }}>Failed</span>
                        )}
                        {result === 'no-votes' && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-muted)', color: 'var(--color-fg-subtle)', border: 'var(--border)', whiteSpace: 'nowrap' }}>No votes</span>
                        )}
                        {isWithdrawn && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-muted)', color: 'var(--color-fg-subtle)', border: 'var(--border)', whiteSpace: 'nowrap' }}>Withdrawn</span>
                        )}
                        {isDeliberating && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-muted)', color: 'var(--color-fg-muted)', border: 'var(--border)', whiteSpace: 'nowrap' }}>Deliberating</span>
                        )}
                        {isOpen && !deadline && !isDeliberating && (
                          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)', whiteSpace: 'nowrap' }}>Open</span>
                        )}
                        {deadline && (
                          <span style={{
                            fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', whiteSpace: 'nowrap',
                            background: deadline.urgent ? 'var(--color-warning-bg)' : 'var(--color-bg-muted)',
                            color: deadline.urgent ? 'var(--color-warning)' : 'var(--color-fg-muted)',
                            border: deadline.urgent ? '1px solid var(--color-warning-border)' : 'var(--border)',
                          }}>
                            {deadline.label}
                          </span>
                        )}
                        {myVote && (
                          <span className={styles.myVote}>Your vote: <strong>{myVote.choice}</strong></span>
                        )}
                      </div>
                      {p.tags && (p.tags as string[]).length > 0 && (
                        <div className={styles.cardTags}>
                          {(p.tags as string[]).map((tag: string) => (
                            <span key={tag} data-testid={`proposal-card-tag-${tag}`} className={styles.cardTag}>{tag}</span>
                          ))}
                        </div>
                      )}
                      {author && <p className={styles.cardAuthor}>by {author.name}</p>}
                    </div>
                    {!isDraft && (
                      <div className={styles.cardVotes}>
                        {(org.voting_visibility !== 'hidden' || !isOpen) ? (
                          <>
                            <div className={styles.voteYes}>↑ {yes}</div>
                            <div className={styles.voteNo}>↓ {no}</div>
                            {abstain > 0 && <div className={styles.voteAbstain}>— {abstain}</div>}
                          </>
                        ) : (
                          <div className={styles.voteHidden}>hidden</div>
                        )}
                        {commentCount > 0 && (
                          <div className={styles.voteComments}>{commentCount} {commentCount === 1 ? 'comment' : 'comments'}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
