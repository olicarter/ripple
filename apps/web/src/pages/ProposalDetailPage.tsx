import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from '@tanstack/react-router';
import { useLiveQuery } from '@tanstack/react-db';
import { v4 as uuid } from 'uuid';
import { usersCollection, membershipsCollection } from '../collections';
import { useOrg } from '../OrgContext';
import { proposalsApi, commentsApi, argumentsApi, vetoesApi, endorsementsApi, boostsApi, predictionsApi, orgsApi, votesApi, proposalSignaturesApi, proposalLinksApi, aiApi, DEFAULT_FEATURES, type OrgFeatures, type TallyResult, type DelegationVote, type DelegationChain, type Proposal, type ProposalOption, type ProposalReaction, type ProposalSignature, type ProposalLinkItem, type Topic, type Vote, type User, type Comment, type CommentReaction, type ProposalVersion, type Membership, type Argument, type Veto, type Endorsement, type PredictionMarket, type ArgumentCluster, type InterpretedVote } from '../api';
import { VoteTally } from '../components/VoteTally';
import { MarkdownContent } from '../components/MarkdownContent';
import { EmptyState } from '../components/EmptyState';
import { ConfirmButton } from '../components/ConfirmButton';
import { MentionTextarea, type MentionTextareaHandle } from '../components/MentionTextarea';
import { useCurrentUser } from '../context';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import { formatDate, formatDatetime, formatRelative } from '../utils/format';
import styles from './ProposalDetailPage.module.css';

const TITLE_MAX = 200;
const DESC_MAX = 10000;
const COMMENT_MAX = 5000;

type VoteChoice = 'yes' | 'no' | 'abstain';

const choiceColors: Record<VoteChoice, string> = {
  yes: '#2d9a4e',
  no: '#d94040',
  abstain: '#888',
};

function formatDeadline(closesAt: string): { label: string; subtext: string; urgent: boolean } {
  const ms = new Date(closesAt).getTime() - Date.now();
  if (ms <= 0) return { label: 'Closing shortly', subtext: '', urgent: true };
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(ms / 3600000);
  const days = Math.floor(ms / 86400000);
  const date = formatDatetime(closesAt);
  if (minutes < 60) return { label: `${minutes} minutes left`, subtext: `Closes ${date}`, urgent: true };
  if (hours < 24) return { label: `${hours} hour${hours !== 1 ? 's' : ''} left`, subtext: `Closes ${date}`, urgent: hours < 6 };
  return { label: `${days} day${days !== 1 ? 's' : ''} left`, subtext: `Closes ${date}`, urgent: false };
}

function computeResult(
  tally: TallyResult,
  threshold: number,
  quorumType?: 'soft' | 'hard',
  vetoed?: boolean,
  proposalType?: string,
): 'passed' | 'failed' | 'no-votes' | 'blocked' | 'advisory' {
  if (vetoed) return 'failed';
  if (tally.quorum_met === false && quorumType === 'hard') return 'failed';
  if (proposalType === 'temperature_check') return 'advisory';
  if (proposalType === 'consent') {
    if (tally.no > 0) return 'blocked';
    if (tally.yes === 0 && tally.no === 0) return 'no-votes';
    return 'passed';
  }
  const decisive = tally.yes + tally.no;
  if (decisive === 0) return 'no-votes';
  return (tally.yes / decisive) * 100 >= threshold ? 'passed' : 'failed';
}

export function ProposalDetailPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const currentUser = useCurrentUser();
  const { org, collections: { proposalsCollection, topicsCollection, votesCollection, commentsCollection, commentReactionsCollection, argumentsCollection, proposalOptionsCollection } } = useOrg();
  const features: OrgFeatures = { ...DEFAULT_FEATURES, ...(org.features ?? {}) };

  const { data: allProposals } = useLiveQuery(proposalsCollection);
  const { data: allTopics } = useLiveQuery(topicsCollection);
  const { data: allVotes } = useLiveQuery(votesCollection);
  const { data: allProposalOptions } = useLiveQuery(proposalOptionsCollection);
  const { data: allUsers } = useLiveQuery(usersCollection);
  const { data: allComments } = useLiveQuery(commentsCollection);
  const { data: allReactions } = useLiveQuery(commentReactionsCollection);
  const { data: allArguments } = useLiveQuery(argumentsCollection);
  const { data: allMemberships } = useLiveQuery(membershipsCollection);

  const addToast = useToast();

  const [tally, setTally] = useState<TallyResult | null>(null);
  const [tallyLoading, setTallyLoading] = useState(true);
  const [delegationVote, setDelegationVote] = useState<DelegationVote | null>(null);
  const [delegationChain, setDelegationChain] = useState<DelegationChain | null>(null);
  const [voting, setVoting] = useState(false);
  const [voteError, setVoteError] = useState('');
  const [changingVote, setChangingVote] = useState(false);
  const [voteReason, setVoteReason] = useState('');
  const [voteCount, setVoteCount] = useState(1);
  const [approvalSelections, setApprovalSelections] = useState<Set<string>>(new Set());
  const [submittingApprovals, setSubmittingApprovals] = useState(false);
  const [scoreMap, setScoreMap] = useState<Record<string, number>>({});
  const [submittingScores, setSubmittingScores] = useState(false);
  const [rankOrder, setRankOrder] = useState<string[]>([]);
  const [submittingRankings, setSubmittingRankings] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actioning, setActioning] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [postingComment, setPostingComment] = useState(false);
  const commentTextareaRef = useRef<MentionTextareaHandle>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editTagInput, setEditTagInput] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [editError, setEditError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [hidingCommentId, setHidingCommentId] = useState<string | null>(null);
  const [hideReason, setHideReason] = useState('');
  const [argBody, setArgBody] = useState('');
  const [argSide, setArgSide] = useState<'for' | 'against'>('for');
  const [postingArg, setPostingArg] = useState(false);
  const [savingOutcome, setSavingOutcome] = useState(false);
  const [vetoes, setVetoes] = useState<Veto[]>([]);
  const [vetoReason, setVetoReason] = useState('');
  const [castingVeto, setCastingVeto] = useState(false);
  const [showVetoForm, setShowVetoForm] = useState(false);
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [endorsing, setEndorsing] = useState(false);
  const [minEndorsementsLive, setMinEndorsementsLive] = useState<number | null>(null);
  const [versions, setVersions] = useState<ProposalVersion[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [reactions, setReactions] = useState<ProposalReaction[]>([]);
  const [reactingEmoji, setReactingEmoji] = useState<string | null>(null);
  const [signatures, setSignatures] = useState<ProposalSignature[]>([]);
  const [signatureCount, setSignatureCount] = useState<number>(0);
  const [signing, setSigning] = useState(false);
  const [showAmendForm, setShowAmendForm] = useState(false);
  const [amendText, setAmendText] = useState('');
  const [amendDeadline, setAmendDeadline] = useState('');
  const [submittingAmend, setSubmittingAmend] = useState(false);
  const [links, setLinks] = useState<ProposalLinkItem[]>([]);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkTargetId, setLinkTargetId] = useState('');
  const [linkType, setLinkType] = useState<'supersedes' | 'related_to' | 'blocks' | 'depends_on'>('related_to');
  const [addingLink, setAddingLink] = useState(false);
  const [watching, setWatching] = useState(false);
  const [watchLoading, setWatchLoading] = useState(false);
  const [voteCarrying, setVoteCarrying] = useState<Array<{ voter: { user_id: string; name: string }; carrying: Array<{ user_id: string; name: string }> }>>([]);
  const [jury, setJury] = useState<Array<{ user_id: string; name: string; has_voted: boolean }> | null>(null);
  const [constitutionalOutcome, setConstitutionalOutcome] = useState<{ outcome: string; hash: string; votes_summary: object; signed_at: string } | null>(null);
  const [selectingJury, setSelectingJury] = useState(false);
  const [jurySize, setJurySize] = useState('5');
  const [boostTotal, setBoostTotal] = useState<number>(0);
  const [userBoostAmount, setUserBoostAmount] = useState<number | null>(null);
  const [boosting, setBoosting] = useState(false);
  const [predictionMarket, setPredictionMarket] = useState<PredictionMarket | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarising, setSummarising] = useState(false);
  const [plainLanguage, setPlainLanguage] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [showPlainLanguage, setShowPlainLanguage] = useState(false);
  const [argumentClusters, setArgumentClusters] = useState<ArgumentCluster[] | null>(null);
  const [clustering, setClustering] = useState(false);
  const [nlVoteInput, setNlVoteInput] = useState('');
  const [interpretingVote, setInterpretingVote] = useState(false);
  const [interpretedVote, setInterpretedVote] = useState<InterpretedVote | null>(null);
  const [replyBody, setReplyBody] = useState('');
  const [translatedDescription, setTranslatedDescription] = useState<string | null>(null);
  const [translatingDescription, setTranslatingDescription] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [translatedComments, setTranslatedComments] = useState<Record<string, string>>({});
  const [translatingComments, setTranslatingComments] = useState<Set<string>>(new Set());
  const browserLanguage = (() => {
    try {
      return new Intl.DisplayNames(['en'], { type: 'language' }).of(navigator.language.split('-')[0]) ?? null;
    } catch { return null; }
  })();

  const proposal = (allProposals ?? []).find((p: Proposal) => p.id === id);
  const topic = proposal
    ? (allTopics ?? []).find((t: Topic) => t.id === proposal.topic_id)
    : undefined;
  const author = proposal?.author_id
    ? (allUsers ?? []).find((u: User) => u.id === proposal.author_id)
    : undefined;
  const myVote = currentUser
    ? (allVotes ?? []).find((v: Vote) => v.proposal_id === id && v.user_id === currentUser.id)
    : undefined;
  const myApprovalVotes = currentUser
    ? (allVotes ?? []).filter((v: Vote) => v.proposal_id === id && v.user_id === currentUser.id)
    : [];

  const myMembership = currentUser
    ? (allMemberships ?? []).find((m: Membership) => m.organisation_id === org.id && m.user_id === currentUser.id)
    : undefined;
  const ROLE_RANK: Record<string, number> = { member: 1, moderator: 2, admin: 3 };
  const isModerator = (ROLE_RANK[myMembership?.role ?? ''] ?? 0) >= ROLE_RANK['moderator'];
  const vetoRole = (org as { veto_role?: string }).veto_role ?? 'admin';
  const canVeto = currentUser && (ROLE_RANK[myMembership?.role ?? ''] ?? 0) >= (ROLE_RANK[vetoRole] ?? ROLE_RANK['admin']);
  const myVeto = currentUser ? vetoes.find((v) => v.author_id === currentUser.id) : undefined;
  const minEndorsements = minEndorsementsLive ?? (org as { min_endorsements?: number }).min_endorsements ?? 0;
  const myEndorsement = currentUser ? endorsements.find((e) => e.user_id === currentUser.id) : undefined;
  const endorsementsNeeded = Math.max(0, minEndorsements - endorsements.length);

  async function fetchTally() {
    setTallyLoading(true);
    try {
      const result = await proposalsApi.tally(id);
      setTally(result);
    } catch {
      // ignore
    } finally {
      setTallyLoading(false);
    }
  }

  async function fetchMyDelegationVote() {
    if (!currentUser) return;
    try {
      const [vote, chain] = await Promise.all([
        proposalsApi.myDelegationVote(id),
        proposalsApi.myDelegationChain(id),
      ]);
      setDelegationVote(vote);
      setDelegationChain(chain);
    } catch {
      setDelegationVote(null);
      setDelegationChain(null);
    }
  }

  async function fetchVetoes() {
    try {
      const result = await fetch(`/api/proposals/${id}/vetoes`, { credentials: 'include' });
      if (result.ok) setVetoes(await result.json());
    } catch {
      // ignore
    }
  }

  async function fetchEndorsements() {
    try {
      const result = await endorsementsApi.list(id);
      setEndorsements(result);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchTally();
    fetchVetoes();
    fetchEndorsements();
    boostsApi.get(id).then((r) => { setBoostTotal(r.total); setUserBoostAmount(r.user_amount); }).catch(() => {});
    predictionsApi.get(id).then(setPredictionMarket).catch(() => {});
    proposalsApi.versions(id).then(setVersions).catch(() => setVersions([]));
    orgsApi.get(org.slug).then((o) => setMinEndorsementsLive(o.min_endorsements ?? 0)).catch(() => {});
    proposalsApi.listReactions(id).then(setReactions).catch(() => {});
    proposalSignaturesApi.list(id).then((r) => { setSignatures(r.signatures); setSignatureCount(r.count); }).catch(() => {});
    proposalLinksApi.list(id).then(setLinks).catch(() => {});
    proposalsApi.getCarrying(id).then(setVoteCarrying).catch(() => {});
    proposalsApi.getJury(id).then(setJury).catch(() => {});
    proposalsApi.getConstitutionalOutcome(id).then(setConstitutionalOutcome).catch(() => {});
  }, [id]);

  useEffect(() => {
    if (currentUser) {
      proposalsApi.getWatchStatus(id).then((r) => setWatching(r.watching)).catch(() => {});
    }
  }, [id, currentUser?.id]);

  useEffect(() => {
    if (currentUser && !myVote) {
      fetchMyDelegationVote();
    } else {
      setDelegationVote(null);
      setDelegationChain(null);
    }
  }, [id, currentUser?.id, myVote?.id]);

  useEffect(() => {
    if (!proposal) return;
    const prevTitle = document.title;
    document.title = `${proposal.title} — Ripple`;
    const baseUrl = window.location.origin;
    const imageUrl = `${baseUrl}/api/proposals/${id}/og-image`;
    const canonicalUrl = `${baseUrl}${window.location.pathname}`;
    const tags: Array<{ property?: string; name?: string; content: string }> = [
      { property: 'og:type', content: 'article' },
      { property: 'og:title', content: proposal.title },
      { property: 'og:description', content: proposal.description?.slice(0, 200) ?? `A proposal on Ripple` },
      { property: 'og:image', content: imageUrl },
      { property: 'og:url', content: canonicalUrl },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: proposal.title },
      { name: 'twitter:image', content: imageUrl },
    ];
    const els: HTMLMetaElement[] = tags.map((t) => {
      const meta = document.createElement('meta');
      if (t.property) meta.setAttribute('property', t.property);
      if (t.name) meta.setAttribute('name', t.name);
      meta.setAttribute('content', t.content);
      document.head.appendChild(meta);
      return meta;
    });
    return () => {
      document.title = prevTitle;
      els.forEach((el) => el.remove());
    };
  }, [proposal?.id, proposal?.title]);

  useEffect(() => {
    const type = proposal?.proposal_type;
    if (type === 'approval') {
      setApprovalSelections(new Set(myApprovalVotes.map((v: Vote) => v.option_id).filter(Boolean) as string[]));
    } else if (type === 'score_voting') {
      const map: Record<string, number> = {};
      for (const v of myApprovalVotes as Vote[]) {
        if (v.option_id && v.score != null) map[v.option_id] = v.score as number;
      }
      setScoreMap(map);
    } else if (type === 'ranked_choice') {
      const sorted = (myApprovalVotes as Vote[])
        .filter((v) => v.option_id && v.rank_position != null)
        .sort((a, b) => (a.rank_position as number) - (b.rank_position as number));
      setRankOrder(sorted.map((v) => v.option_id as string));
    }
  }, [proposal?.proposal_type, myApprovalVotes.length]);

  async function submitScores() {
    if (!currentUser) return;
    setSubmittingScores(true);
    try {
      const scores = Object.entries(scoreMap).map(([option_id, score]) => ({ option_id, score }));
      await votesApi.setScores(id, scores);
      addToast('Scores saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save scores', 'error');
    } finally {
      setSubmittingScores(false);
    }
  }

  async function submitRankings() {
    if (!currentUser) return;
    setSubmittingRankings(true);
    try {
      await votesApi.setRankings(id, rankOrder);
      addToast('Rankings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save rankings', 'error');
    } finally {
      setSubmittingRankings(false);
    }
  }

  async function submitApprovals() {
    if (!currentUser) return;
    setSubmittingApprovals(true);
    try {
      await votesApi.setApprovals(id, [...approvalSelections]);
      addToast('Approvals saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save approvals', 'error');
    } finally {
      setSubmittingApprovals(false);
    }
  }

  async function castVote(choice: VoteChoice | null, optionId?: string) {
    if (!currentUser) return;
    setVoteError('');
    setVoting(true);
    try {
      const tx = votesCollection.insert({
        id: uuid(),
        proposal_id: id,
        organisation_id: org.id,
        user_id: currentUser.id,
        choice: choice ?? null,
        option_id: optionId ?? null,
        reason: voteReason.trim() || null,
        vote_count: (proposal as any).quadratic_voting ? voteCount : 1,
        created_at: new Date().toISOString(),
      });
      await tx.isPersisted.promise;
      await fetchTally();
      setChangingVote(false);
      setVoteReason('');
      setVoteCount(1);
      setDelegationVote(null);
      setDelegationChain(null);
      addToast('Vote cast', 'success');
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Failed to cast vote.');
    } finally {
      setVoting(false);
    }
  }

  async function changeVote(choice: VoteChoice | null, optionId?: string) {
    if (!myVote) return;
    setVoteError('');
    setVoting(true);
    try {
      const tx = votesCollection.update(myVote.id, (draft: Vote) => {
        draft.choice = choice ?? null;
        draft.option_id = optionId ?? null;
        draft.reason = voteReason.trim() || null;
      });
      await tx.isPersisted.promise;
      await fetchTally();
      setChangingVote(false);
      setVoteReason('');
      addToast('Vote updated', 'success');
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Failed to update vote.');
    } finally {
      setVoting(false);
    }
  }

  async function removeVote() {
    if (!myVote) return;
    setVoteError('');
    setVoting(true);
    try {
      const tx = votesCollection.delete(myVote.id);
      await tx.isPersisted.promise;
      await fetchTally();
      addToast('Vote removed', 'info');
    } catch (err) {
      setVoteError(err instanceof Error ? err.message : 'Failed to remove vote.');
    } finally {
      setVoting(false);
    }
  }

  async function toggleWatch() {
    if (!currentUser) return;
    setWatchLoading(true);
    try {
      if (watching) {
        await proposalsApi.unwatch(id);
        setWatching(false);
        addToast('Unwatched proposal', 'info');
      } else {
        await proposalsApi.watch(id);
        setWatching(true);
        addToast('Watching proposal', 'success');
      }
    } catch {
      addToast('Failed to update watch', 'error');
    } finally {
      setWatchLoading(false);
    }
  }

  if (!proposal) {
    return <p style={{ color: '#999', fontSize: 14 }}>Loading…</p>;
  }

  const isDraft = proposal.status === 'draft';
  const isOpen = proposal.status === 'open';
  const isWithdrawn = proposal.status === 'withdrawn';
  const isDiscussion = proposal.proposal_type === 'discussion';
  const isMultipleChoice = proposal.proposal_type === 'multiple_choice';
  const isApproval = proposal.proposal_type === 'approval';
  const isScoreVoting = proposal.proposal_type === 'score_voting';
  const isRankedChoice = proposal.proposal_type === 'ranked_choice';
  const isTemperatureCheck = proposal.proposal_type === 'temperature_check';
  const isConsent = proposal.proposal_type === 'consent';
  const isPetition = proposal.proposal_type === 'petition';
  const isAmendment = proposal.proposal_type === 'amendment';
  const parentProposal = isAmendment && proposal.parent_proposal_id
    ? (allProposals ?? []).find((p: Proposal) => p.id === proposal.parent_proposal_id)
    : null;
  const pendingAmendments = (allProposals ?? []).filter(
    (p: Proposal) => p.parent_proposal_id === id && p.proposal_type === 'amendment' && p.status === 'open',
  );
  const proposalOptions = ((allProposalOptions ?? []) as ProposalOption[])
    .filter((o) => o.proposal_id === id)
    .sort((a, b) => a.position - b.position);
  const isDeliberating = isOpen && !!proposal.deliberation_ends_at && new Date(proposal.deliberation_ends_at as string) > new Date();
  const isAuthor = currentUser?.id === proposal.author_id;
  const canEndorse = currentUser && isDraft && !isAuthor && !!myMembership && !myEndorsement;
  const publishBlocked = isDraft && minEndorsements > 0 && endorsements.length < minEndorsements;
  const threshold = proposal.threshold ?? 50;
  const deadline = isOpen && proposal.closes_at ? formatDeadline(proposal.closes_at) : null;
  const result = proposal.status === 'closed' && tally && !isApproval && !isScoreVoting && !isRankedChoice
    ? computeResult(tally, threshold, proposal.quorum_type as 'soft' | 'hard', vetoes.length > 0, proposal.proposal_type)
    : null;
  const allProposalComments = (allComments ?? []).filter((c: Comment) => c.proposal_id === id);
  const comments = allProposalComments
    .filter((c: Comment) => !c.parent_comment_id)
    .sort((a: Comment, b: Comment) => {
      if (a.pinned_at && !b.pinned_at) return -1;
      if (!a.pinned_at && b.pinned_at) return 1;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  const repliesFor = (parentId: string) =>
    allProposalComments
      .filter((c: Comment) => c.parent_comment_id === parentId)
      .sort((a: Comment, b: Comment) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const proposalArguments = (allArguments ?? [])
    .filter((a: Argument) => a.proposal_id === id)
    .sort((a: Argument, b: Argument) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const forArguments = proposalArguments.filter((a: Argument) => a.side === 'for');
  const againstArguments = proposalArguments.filter((a: Argument) => a.side === 'against');
  const userMap = Object.fromEntries((allUsers ?? []).map((u: User) => [u.id, u]));

  const delegationSuggestions = (() => {
    if (!currentUser || !isOpen || myVote || delegationChain?.voter) return [];
    const orgMembers = (allMemberships ?? []).filter((m: Membership) => m.organisation_id === org.id && m.user_id !== currentUser.id);
    const nonDraftCount = (allProposals ?? []).filter((p: Proposal) => p.status !== 'draft' && p.organisation_id === org.id).length;
    if (nonDraftCount === 0) return [];
    return orgMembers
      .map((m: Membership) => {
        const voted = new Set((allVotes ?? []).filter((v: Vote) => v.user_id === m.user_id).map((v: Vote) => v.proposal_id)).size;
        return { userId: m.user_id, pct: Math.round((voted / nonDraftCount) * 100) };
      })
      .filter((s: { userId: string; pct: number }) => s.pct >= 50)
      .sort((a: { userId: string; pct: number }, b: { userId: string; pct: number }) => b.pct - a.pct)
      .slice(0, 3);
  })();

  async function handleAction(successMsg: string, action: () => Promise<unknown>) {
    setActioning(true);
    setActionError('');
    try {
      await action();
      addToast(successMsg, 'success');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
    }
    setActioning(false);
  }

  async function postComment(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !commentBody.trim()) return;
    setPostingComment(true);
    try {
      const tx = commentsCollection.insert({
        id: uuid(),
        proposal_id: id,
        organisation_id: org.id,
        author_id: currentUser.id,
        body: commentBody.trim(),
        created_at: new Date().toISOString(),
      } as Comment);
      await tx.isPersisted.promise;
      setCommentBody('');
      addToast('Comment posted', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to post comment', 'error');
    } finally {
      setPostingComment(false);
    }
  }

  async function postReply(parentId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !replyBody.trim()) return;
    try {
      const tx = commentsCollection.insert({
        id: uuid(),
        proposal_id: id,
        organisation_id: org.id,
        author_id: currentUser.id,
        body: replyBody.trim(),
        parent_comment_id: parentId,
        created_at: new Date().toISOString(),
      } as Comment);
      await tx.isPersisted.promise;
      setReplyBody('');
      setReplyingToId(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to post reply', 'error');
    }
  }

  async function deleteComment(commentId: string) {
    try {
      const tx = commentsCollection.delete(commentId);
      await tx.isPersisted.promise;
      addToast('Comment deleted', 'info');
    } catch {
      addToast('Failed to delete comment', 'error');
    }
  }

  async function saveEditComment(commentId: string, e: React.FormEvent) {
    e.preventDefault();
    if (!editCommentBody.trim()) return;
    try {
      const tx = commentsCollection.update(commentId, (draft: Comment) => {
        draft.body = editCommentBody.trim();
      });
      await tx.isPersisted.promise;
      setEditingCommentId(null);
      addToast('Comment updated', 'success');
    } catch {
      addToast('Failed to update comment', 'error');
    }
  }

  async function postArgument(e: React.FormEvent) {
    e.preventDefault();
    if (!currentUser || !argBody.trim()) return;
    setPostingArg(true);
    try {
      await argumentsApi.create(id, { id: crypto.randomUUID(), side: argSide, body: argBody.trim() });
      setArgBody('');
      addToast(`${argSide === 'for' ? 'For' : 'Against'} argument added`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to post argument', 'error');
    } finally {
      setPostingArg(false);
    }
  }

  async function deleteArgument(argId: string) {
    try {
      await argumentsApi.delete(argId);
      addToast('Argument removed', 'info');
    } catch {
      addToast('Failed to delete argument', 'error');
    }
  }

  async function pinComment(commentId: string) {
    try {
      await commentsApi.pin(commentId);
      addToast('Comment pinned', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to pin comment', 'error');
    }
  }

  async function unpinComment(commentId: string) {
    try {
      await commentsApi.unpin(commentId);
      addToast('Comment unpinned', 'info');
    } catch {
      addToast('Failed to unpin comment', 'error');
    }
  }

  async function handleReact(emoji: string) {
    if (!currentUser || reactingEmoji) return;
    setReactingEmoji(emoji);
    try {
      const myReaction = reactions.find((r) => r.user_id === currentUser.id);
      if (myReaction?.emoji === emoji) {
        await proposalsApi.removeReaction(id);
        setReactions((prev) => prev.filter((r) => r.user_id !== currentUser.id));
      } else {
        const updated = await proposalsApi.react(id, emoji);
        setReactions((prev) => {
          const without = prev.filter((r) => r.user_id !== currentUser.id);
          return [...without, updated];
        });
      }
    } catch {
      addToast('Failed to react', 'error');
    } finally {
      setReactingEmoji(null);
    }
  }

  async function handleAddLink() {
    if (!linkTargetId.trim() || addingLink) return;
    setAddingLink(true);
    try {
      await proposalLinksApi.add(id, { target_proposal_id: linkTargetId.trim(), link_type: linkType });
      const updated = await proposalLinksApi.list(id);
      setLinks(updated);
      setLinkTargetId('');
      setShowLinkForm(false);
      addToast('Link added', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add link', 'error');
    } finally {
      setAddingLink(false);
    }
  }

  async function handleRemoveLink(linkId: string) {
    try {
      await proposalLinksApi.remove(id, linkId);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
      addToast('Link removed', 'info');
    } catch {
      addToast('Failed to remove link', 'error');
    }
  }

  async function handleSubmitAmendment() {
    if (!currentUser || !amendText.trim() || submittingAmend) return;
    setSubmittingAmend(true);
    try {
      await proposalsApi.create({
        id: uuid(),
        organisation_id: org.id,
        topic_id: proposal.topic_id,
        title: `Amendment to: ${proposal.title}`,
        description: `Proposed amendment to replace the description of "${proposal.title}"`,
        proposal_type: 'amendment',
        parent_proposal_id: id,
        amendment_text: amendText.trim(),
        closes_at: amendDeadline ? new Date(amendDeadline).toISOString() : null,
        threshold: 50,
        status: 'open',
      });
      setShowAmendForm(false);
      setAmendText('');
      setAmendDeadline('');
      addToast('Amendment proposed', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to propose amendment', 'error');
    } finally {
      setSubmittingAmend(false);
    }
  }

  async function handleSign() {
    if (!currentUser || signing) return;
    setSigning(true);
    try {
      const mySig = signatures.find((s) => s.user_id === currentUser.id);
      if (mySig) {
        const result = await proposalSignaturesApi.unsign(id);
        setSignatures((prev) => prev.filter((s) => s.user_id !== currentUser.id));
        setSignatureCount(result.count);
        addToast('Signature removed', 'info');
      } else {
        const result = await proposalSignaturesApi.sign(id);
        setSignatures((prev) => [...prev, { id: '', proposal_id: id, organisation_id: org.id, user_id: currentUser.id, created_at: new Date().toISOString() }]);
        setSignatureCount(result.count);
        if (result.transitioned) {
          addToast('Threshold reached — petition has transitioned to a vote!', 'success');
        } else {
          addToast('Signed', 'success');
        }
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed', 'error');
    } finally {
      setSigning(false);
    }
  }

  async function endorseProposal() {
    if (!canEndorse) return;
    setEndorsing(true);
    try {
      await endorsementsApi.endorse(id);
      await fetchEndorsements();
      addToast('Proposal endorsed', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to endorse', 'error');
    } finally {
      setEndorsing(false);
    }
  }

  async function retractEndorsement() {
    setEndorsing(true);
    try {
      await endorsementsApi.retract(id);
      await fetchEndorsements();
      addToast('Endorsement retracted', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to retract', 'error');
    } finally {
      setEndorsing(false);
    }
  }

  async function castVeto(e: React.FormEvent) {
    e.preventDefault();
    const reason = vetoReason.trim();
    if (!reason) return;
    setCastingVeto(true);
    try {
      await vetoesApi.cast(id, reason);
      setVetoReason('');
      setShowVetoForm(false);
      await fetchVetoes();
      addToast('Veto cast', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to cast veto', 'error');
    } finally {
      setCastingVeto(false);
    }
  }

  async function retractVeto(vetoId: string) {
    try {
      await vetoesApi.retract(vetoId);
      await fetchVetoes();
      addToast('Veto retracted', 'info');
    } catch {
      addToast('Failed to retract veto', 'error');
    }
  }

  async function saveOutcome(outcome: Proposal['outcome']) {
    setSavingOutcome(true);
    try {
      await proposalsApi.setOutcome(id, outcome);
      addToast('Outcome saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save outcome', 'error');
    } finally {
      setSavingOutcome(false);
    }
  }

  async function hideComment(commentId: string, e: React.FormEvent) {
    e.preventDefault();
    const reason = hideReason.trim();
    if (!reason) return;
    try {
      await commentsApi.hide(commentId, reason);
      setHidingCommentId(null);
      setHideReason('');
      addToast('Comment hidden', 'info');
    } catch {
      addToast('Failed to hide comment', 'error');
    }
  }

  async function unhideComment(commentId: string) {
    try {
      await commentsApi.unhide(commentId);
      addToast('Comment restored', 'success');
    } catch {
      addToast('Failed to unhide comment', 'error');
    }
  }

  async function reactToComment(commentId: string, emoji: string) {
    try {
      await commentsApi.react(commentId, emoji);
    } catch {
      addToast('Failed to react', 'error');
    }
  }

  async function loadVersions() {
    if (versions !== null) {
      setShowVersions((v) => !v);
      return;
    }
    try {
      const data = await proposalsApi.versions(id);
      setVersions(data);
      setShowVersions(true);
    } catch {
      addToast('Failed to load version history', 'error');
    }
  }

  function startEditing() {
    setEditTitle(proposal.title);
    setEditDescription(proposal.description ?? '');
    setEditTags(proposal.tags ?? []);
    setEditTagInput('');
    setEditError('');
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setEditError('');
    try {
      await proposalsApi.update(id, { title: editTitle.trim(), description: editDescription, tags: editTags });
      addToast('Proposal updated', 'success');
      setEditing(false);
      proposalsApi.versions(id).then(setVersions).catch(() => {});
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.page}>
      <Link
        to="/orgs/$slug/proposals"
        params={{ slug: org.slug }}
        className={styles.backLink}
      >
        ← Proposals
      </Link>

      <div className={styles.headerMeta}>
        {topic && (
          <span className={`${styles.badge} ${styles.badgeDefault}`}>{topic.name}</span>
        )}
        {proposal.pinned && (
          <span data-testid="pinned-badge" className={`${styles.badge} ${styles.badgeDefault}`}>📌 Pinned</span>
        )}
        <span className={`${styles.badge} ${isDraft ? styles.badgeDraft : isOpen ? styles.badgeOpen : styles.badgeDefault}`}>
          {proposal.status}
        </span>
        {isDraft && proposal.opens_at && (
          <span className={`${styles.badge} ${styles.badgeDefault}`} title={`Opens ${formatDatetime(proposal.opens_at)}`}>
            Scheduled
          </span>
        )}
        {result === 'passed' && <span className={`${styles.badge} ${styles.badgeSuccess}`}>Passed</span>}
        {result === 'failed' && <span className={`${styles.badge} ${styles.badgeError}`}>Failed</span>}
        {result === 'blocked' && <span className={`${styles.badge} ${styles.badgeError}`}>Blocked</span>}
        {result === 'advisory' && <span className={`${styles.badge} ${styles.badgeDefault}`}>Advisory</span>}
      </div>

      {editing ? (
        <form onSubmit={saveEdit} className={styles.editForm}>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
              <label htmlFor="edit-title" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)' }}>Title</label>
              {editTitle.length > TITLE_MAX - 40 && (
                <span style={{ fontSize: 'var(--text-xs)', color: editTitle.length >= TITLE_MAX ? 'var(--color-error)' : 'var(--color-fg-subtle)' }}>
                  {TITLE_MAX - editTitle.length} left
                </span>
              )}
            </div>
            <input
              id="edit-title"
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value.slice(0, TITLE_MAX))}
              required
              maxLength={TITLE_MAX}
              className={styles.editInput}
            />
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
              <label htmlFor="edit-description" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)' }}>Description</label>
              {editDescription.length > DESC_MAX - 500 && (
                <span style={{ fontSize: 'var(--text-xs)', color: editDescription.length >= DESC_MAX ? 'var(--color-error)' : 'var(--color-fg-subtle)' }}>
                  {DESC_MAX - editDescription.length} left
                </span>
              )}
            </div>
            <textarea
              id="edit-description"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value.slice(0, DESC_MAX))}
              rows={5}
              maxLength={DESC_MAX}
              className={styles.editTextarea}
            />
          </div>
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-medium)', color: 'var(--color-fg-muted)', display: 'block', marginBottom: 'var(--space-2)' }}>Tags</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
              {editTags.map((t) => (
                <span key={t} className={styles.tagChip}>
                  {t}
                  <button type="button" aria-label={`Remove tag ${t}`} onClick={() => setEditTags(editTags.filter((x) => x !== t))} className={styles.tagChipRemove}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                data-testid="tag-input"
                type="text"
                value={editTagInput}
                onChange={(e) => setEditTagInput(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ',') && editTagInput.trim()) {
                    e.preventDefault();
                    const tag = editTagInput.trim();
                    if (!editTags.includes(tag)) setEditTags([...editTags, tag]);
                    setEditTagInput('');
                  }
                }}
                placeholder="Add tag…"
                className={styles.editTextarea}
                style={{ height: 32, padding: '0 var(--space-3)', resize: 'none' }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="add-tag-btn"
                onClick={() => {
                  const tag = editTagInput.trim();
                  if (tag && !editTags.includes(tag)) setEditTags([...editTags, tag]);
                  setEditTagInput('');
                }}
                disabled={!editTagInput.trim()}
              >Add</Button>
            </div>
          </div>
          {editError && <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-base)', margin: '0 0 var(--space-3)' }}>{editError}</p>}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button type="submit" size="sm" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              {proposal.title}
            </h1>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
              {currentUser && (
                <Button type="button" variant="ghost" size="sm" onClick={toggleWatch} disabled={watchLoading}
                  title={watching ? 'Stop receiving notifications for this proposal' : 'Get notified about new comments on this proposal'}
                >
                  {watching ? '★ Watching' : '☆ Watch'}
                </Button>
              )}
              {(isAuthor || isModerator) && (isDraft || isOpen) && (
                <Button type="button" variant="secondary" size="sm" onClick={startEditing}>
                  Edit
                </Button>
              )}
            </div>
          </div>
          {(isDiscussion || isMultipleChoice || isApproval || isScoreVoting || isRankedChoice || isTemperatureCheck || isConsent || isPetition || isAmendment || proposal.impact_level || proposal.anonymous_voting) && (
            <div className={styles.headerMeta} style={{ marginBottom: 'var(--space-4)' }}>
              {isDiscussion && <span className={`${styles.badge} ${styles.badgeDefault}`}>Discussion</span>}
              {isMultipleChoice && <span className={`${styles.badge} ${styles.badgeDefault}`}>Multiple choice</span>}
              {isApproval && <span className={`${styles.badge} ${styles.badgeDefault}`}>Approval voting</span>}
              {isScoreVoting && <span className={`${styles.badge} ${styles.badgeDefault}`}>Score voting</span>}
              {isRankedChoice && <span className={`${styles.badge} ${styles.badgeDefault}`}>Ranked choice</span>}
              {isTemperatureCheck && <span className={`${styles.badge} ${styles.badgeDefault}`}>Temperature check</span>}
              {isConsent && <span className={`${styles.badge} ${styles.badgeDefault}`}>Consent</span>}
              {isPetition && <span className={`${styles.badge} ${styles.badgeDefault}`}>Petition</span>}
              {isAmendment && <span className={`${styles.badge} ${styles.badgeDefault}`}>Amendment</span>}
              {proposal.anonymous_voting && <span className={`${styles.badge} ${styles.badgeDefault}`}>Anonymous voting</span>}
              {proposal.conviction_voting && <span className={`${styles.badge} ${styles.badgeDefault}`}>Conviction voting</span>}
              {(proposal as any).quadratic_voting && <span className={`${styles.badge} ${styles.badgeDefault}`}>Quadratic voting</span>}
              {proposal.impact_level && (
                <span className={`${styles.badge} ${styles.badgeDefault}`}>
                  {proposal.impact_level.charAt(0).toUpperCase() + proposal.impact_level.slice(1)} impact
                </span>
              )}
            </div>
          )}
          {proposal.tags && proposal.tags.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginBottom: '0.5rem' }}>
              {proposal.tags.map((tag: string) => (
                <span key={tag} data-testid="proposal-tag" style={{ fontSize: 12, padding: '0.15rem 0.5rem', borderRadius: 12, background: '#e8edf7', color: '#3358c4' }}>{tag}</span>
              ))}
            </div>
          )}
          {isAmendment && parentProposal && (
            <div style={{ fontSize: 13, color: '#92400e', background: '#fff7ed', border: '1px solid #fde68a', borderRadius: 4, padding: '0.4rem 0.75rem', marginBottom: '0.75rem' }}>
              Amendment to: <Link to="/orgs/$slug/proposals/$id" params={{ slug: org.slug, id: parentProposal.id }} style={{ color: '#92400e', fontWeight: 500 }}>{parentProposal.title}</Link>
            </div>
          )}
          {isAmendment && proposal.amendment_text && (
            <div style={{ marginBottom: '0.75rem' }}>
              <p style={{ margin: '0 0 0.3rem', fontSize: 12, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Proposed new description</p>
              <div style={{ border: '1px solid #fde68a', borderRadius: 4, padding: '0.6rem 0.75rem', background: '#fffbeb' }}>
                <MarkdownContent content={proposal.amendment_text} />
              </div>
            </div>
          )}
          {/* AI summary */}
          {!isDiscussion && currentUser && (
            <div style={{ marginBottom: '1rem' }}>
              {!summary ? (
                <button
                  type="button"
                  disabled={summarising}
                  onClick={async () => {
                    setSummarising(true);
                    try {
                      const r = await aiApi.summarise(id);
                      setSummary(r.summary);
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Failed to summarise', 'error');
                    } finally {
                      setSummarising(false);
                    }
                  }}
                  style={{ fontSize: 12, padding: '0.2rem 0.6rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#888' }}
                >
                  {summarising ? 'Summarising…' : '✦ Summarise'}
                </button>
              ) : (
                <div style={{ background: '#f7f7f7', border: '1px solid #eee', borderRadius: 6, padding: '0.75rem 1rem', fontSize: 13, color: '#444', lineHeight: 1.6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Summary</span>
                    <button type="button" onClick={() => setSummary(null)} style={{ fontSize: 11, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>&times;</button>
                  </div>
                  <p style={{ margin: '0.4rem 0 0' }}>{summary}</p>
                </div>
              )}
            </div>
          )}
          {proposal.description && (
            <div style={{ margin: '0 0 0.75rem' }}>
              {currentUser && !isDiscussion && (
                <div style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {plainLanguage && (
                    <button
                      type="button"
                      onClick={() => setShowPlainLanguage((v) => !v)}
                      style={{ fontSize: 11, padding: '0.15rem 0.5rem', border: '1px solid #ddd', borderRadius: 4, background: showPlainLanguage ? '#111' : 'transparent', color: showPlainLanguage ? '#fff' : '#888', cursor: 'pointer' }}
                    >
                      {showPlainLanguage ? 'Original' : 'Plain language'}
                    </button>
                  )}
                  {!plainLanguage && (
                    <button
                      type="button"
                      disabled={rewriting}
                      onClick={async () => {
                        setRewriting(true);
                        try {
                          const r = await aiApi.rewrite(id);
                          setPlainLanguage(r.rewritten);
                          setShowPlainLanguage(true);
                        } catch (err) {
                          addToast(err instanceof Error ? err.message : 'Failed to rewrite', 'error');
                        } finally {
                          setRewriting(false);
                        }
                      }}
                      style={{ fontSize: 11, padding: '0.15rem 0.5rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', color: '#888', cursor: 'pointer' }}
                    >
                      {rewriting ? 'Rewriting…' : '✦ Plain language'}
                    </button>
                  )}
                  {browserLanguage && !translatedDescription && (
                    <button
                      type="button"
                      disabled={translatingDescription}
                      onClick={async () => {
                        setTranslatingDescription(true);
                        try {
                          const r = await aiApi.translate(`${proposal.title}\n\n${proposal.description ?? ''}`, browserLanguage);
                          setTranslatedDescription(r.translated);
                          setShowTranslation(true);
                        } catch (err) {
                          addToast(err instanceof Error ? err.message : 'Failed to translate', 'error');
                        } finally {
                          setTranslatingDescription(false);
                        }
                      }}
                      style={{ fontSize: 11, padding: '0.15rem 0.5rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', color: '#888', cursor: 'pointer' }}
                    >
                      {translatingDescription ? 'Translating…' : `✦ Translate to ${browserLanguage}`}
                    </button>
                  )}
                  {translatedDescription && (
                    <button
                      type="button"
                      onClick={() => setShowTranslation((v) => !v)}
                      style={{ fontSize: 11, padding: '0.15rem 0.5rem', border: '1px solid #ddd', borderRadius: 4, background: showTranslation ? '#111' : 'transparent', color: showTranslation ? '#fff' : '#888', cursor: 'pointer' }}
                    >
                      {showTranslation ? 'Original' : `${browserLanguage}`}
                    </button>
                  )}
                </div>
              )}
              <MarkdownContent content={showTranslation && translatedDescription ? translatedDescription : showPlainLanguage && plainLanguage ? plainLanguage : proposal.description} />
            </div>
          )}
          {versions !== null && versions.length > 0 && (
            <button
              type="button"
              onClick={loadVersions}
              style={{ fontSize: 11, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '0.5rem' }}
            >
              {showVersions ? 'Hide' : `Edited ${versions.length} time${versions.length !== 1 ? 's' : ''} — show history`}
            </button>
          )}
          {showVersions && versions && (
            <div style={{ border: '1px solid #eee', borderRadius: 6, padding: '0.75rem 1rem', marginBottom: '1rem', background: '#fafafa' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: 12, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Edit history</p>
              {versions.map((v, i) => (
                <div key={v.id} style={{ fontSize: 12, color: '#888', marginBottom: i < versions.length - 1 ? '0.5rem' : 0 }}>
                  <span style={{ color: '#555' }}>{v.title}</span>
                  <span style={{ marginLeft: '0.5rem' }}>
                    · {formatDate(v.created_at)}
                  </span>
                  {userMap[v.changed_by ?? ''] && (
                    <span style={{ marginLeft: '0.5rem' }}>by {userMap[v.changed_by!].name}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p style={{ fontSize: 12, color: '#aaa', margin: '0 0 1.5rem' }}>
        {author ? (
          <>
            by{' '}
            <Link to="/orgs/$slug/users/$id" params={{ slug: org.slug, id: author.id }} style={{ color: '#888', textDecoration: 'none' }}>
              {author.name}
            </Link>
            {' · '}
          </>
        ) : null}
        {formatDate(proposal.created_at)}
        {proposal.closed_at && ` · Closed ${formatDate(proposal.closed_at)}`}
      </p>

      {/* Reactions */}
      {currentUser && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          {(['👍', '👎', '💬', '🎉', '🤔'] as const).map((emoji) => {
            const count = reactions.filter((r) => r.emoji === emoji).length;
            const myReaction = reactions.find((r) => r.user_id === currentUser.id);
            const isMyEmoji = myReaction?.emoji === emoji;
            return (
              <button
                key={emoji}
                data-testid={`reaction-${emoji}`}
                onClick={() => handleReact(emoji)}
                disabled={!!reactingEmoji}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  padding: '0.3rem 0.65rem',
                  border: `1px solid ${isMyEmoji ? '#818cf8' : '#ddd'}`,
                  borderRadius: 20,
                  background: isMyEmoji ? '#eef2ff' : '#fafafa',
                  cursor: reactingEmoji ? 'default' : 'pointer',
                  fontSize: 14,
                  color: '#555',
                  fontWeight: isMyEmoji ? 600 : 400,
                  transition: 'border-color 0.1s, background 0.1s',
                }}
              >
                <span>{emoji}</span>
                {count > 0 && <span style={{ fontSize: 12 }}>{count}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Draft banner + endorsements */}
      {isDraft && (
        <div style={{ marginBottom: '1.5rem' }}>
          {/* Endorsement progress */}
          {minEndorsements > 0 && (
            <div style={{
              border: `1px solid ${publishBlocked ? '#fde68a' : '#b3e5c2'}`,
              borderRadius: 6,
              padding: '0.75rem 1.25rem',
              marginBottom: '0.75rem',
              background: publishBlocked ? '#fffbeb' : '#e6f9ed',
            }}>
              <p style={{ margin: '0 0 0.4rem', fontSize: 14, fontWeight: 600, color: publishBlocked ? '#92400e' : '#2d9a4e' }}>
                {endorsements.length} / {minEndorsements} endorsement{minEndorsements !== 1 ? 's' : ''}
                {publishBlocked ? ` — ${endorsementsNeeded} more needed to publish` : ' — ready to publish'}
              </p>
              {endorsements.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.25rem' }}>
                  {endorsements.map((e) => {
                    const endorser = userMap[e.user_id];
                    return (
                      <span key={e.id} data-testid="endorsement-badge" style={{ fontSize: 12, padding: '2px 8px', borderRadius: 12, background: '#e6f9ed', border: '1px solid #b3e5c2', color: '#1a7f37' }}>
                        {endorser?.name ?? 'Member'}
                      </span>
                    );
                  })}
                </div>
              )}
              {canEndorse && (
                <button
                  type="button"
                  onClick={endorseProposal}
                  disabled={endorsing}
                  data-testid="endorse-btn"
                  style={{ marginTop: '0.5rem', fontSize: 13, padding: '0.3rem 0.9rem', cursor: 'pointer', background: '#1a7f37', color: '#fff', border: 'none', borderRadius: 4 }}
                >
                  {endorsing ? 'Endorsing…' : 'Endorse this proposal'}
                </button>
              )}
              {myEndorsement && (
                <button
                  type="button"
                  onClick={retractEndorsement}
                  disabled={endorsing}
                  data-testid="retract-endorsement-btn"
                  style={{ marginTop: '0.5rem', fontSize: 12, padding: '0.3rem 0.7rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd', borderRadius: 4, color: '#888' }}
                >
                  Retract endorsement
                </button>
              )}
            </div>
          )}

          {isAuthor && (
            <div style={{
              border: '1px solid #fde68a',
              borderRadius: 6,
              padding: '0.75rem 1.25rem',
              background: '#fffbeb',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}>
              <span style={{ fontSize: 14, color: '#92400e' }}>
                {publishBlocked
                  ? `Needs ${endorsementsNeeded} more endorsement${endorsementsNeeded !== 1 ? 's' : ''} before publishing.`
                  : 'This proposal is a draft — not yet visible to other members.'}
              </span>
              <button
                onClick={() => handleAction('Proposal published', () => proposalsApi.publish(id))}
                disabled={actioning || publishBlocked}
                title={publishBlocked ? `${endorsementsNeeded} more endorsement${endorsementsNeeded !== 1 ? 's' : ''} required` : undefined}
                style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: publishBlocked ? 'not-allowed' : 'pointer', background: publishBlocked ? '#aaa' : '#b45309', color: '#fff', border: 'none', borderRadius: 4, flexShrink: 0 }}
              >
                Publish
              </button>
            </div>
          )}
          {!isAuthor && minEndorsements === 0 && (
            <div style={{ border: '1px solid #fde68a', borderRadius: 6, padding: '0.75rem 1.25rem', background: '#fffbeb' }}>
              <span style={{ fontSize: 14, color: '#92400e' }}>This proposal is a draft.</span>
            </div>
          )}
        </div>
      )}

      {/* Deliberation / Voting timeline */}
      {isOpen && proposal.deliberation_ends_at && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0, fontSize: 13 }}>
            {[
              { key: 'deliberation', label: 'Deliberation', active: isDeliberating, done: !isDeliberating },
              { key: 'voting', label: 'Voting', active: !isDeliberating, done: false },
              { key: 'closed', label: 'Closed', active: false, done: false },
            ].map((phase, i, arr) => (
              <div key={phase.key} style={{ display: 'flex', alignItems: 'center', flex: i < arr.length - 1 ? 1 : 'none' }}>
                <div style={{
                  padding: '0.3rem 0.9rem',
                  borderRadius: 20,
                  fontWeight: phase.active ? 600 : 400,
                  background: phase.active ? '#6d28d9' : phase.done ? '#e6f9ed' : '#f0f0f0',
                  color: phase.active ? '#fff' : phase.done ? '#2d9a4e' : '#888',
                  border: `1px solid ${phase.active ? '#6d28d9' : phase.done ? '#b3e5c2' : '#e0e0e0'}`,
                  whiteSpace: 'nowrap',
                }}>
                  {phase.done ? '✓ ' : ''}{phase.label}
                </div>
                {i < arr.length - 1 && (
                  <div style={{ flex: 1, height: 1, background: '#e0e0e0', minWidth: 20 }} />
                )}
              </div>
            ))}
          </div>
          {isDeliberating && (
            <p style={{ margin: '0.5rem 0 0', fontSize: 12, color: '#6d28d9' }}>
              Deliberation ends {formatDatetime(proposal.deliberation_ends_at)} — voting opens after.
            </p>
          )}
        </div>
      )}

      {/* Deadline countdown */}
      {deadline && (
        <div
          style={{
            border: `1px solid ${deadline.urgent ? '#fde68a' : '#ddd'}`,
            borderRadius: 6,
            padding: '0.75rem 1.25rem',
            marginBottom: '1.5rem',
            background: deadline.urgent ? '#fffbeb' : '#f9f9f9',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: deadline.urgent ? '#b45309' : '#555' }}>
            {deadline.label}
          </span>
          {deadline.subtext && (
            <span style={{ fontSize: 13, color: '#888' }}>{deadline.subtext}</span>
          )}
        </div>
      )}

      {/* Boost section */}
      {features.proposal_queue && (org as { boost_threshold?: number | null }).boost_threshold != null && (isDraft || isOpen) && currentUser && myMembership && (
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.75rem 1.25rem', marginBottom: '1.5rem', background: '#f9f9f9' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Boosts</span>
              <span style={{ fontSize: 13, color: '#666', marginInlineStart: '0.5rem' }}>
                {boostTotal} / {(org as { boost_threshold?: number | null }).boost_threshold}
                {isDraft && boostTotal < ((org as { boost_threshold?: number | null }).boost_threshold ?? 0) && (
                  <span style={{ color: '#888' }}> — needs {((org as { boost_threshold?: number | null }).boost_threshold ?? 0) - boostTotal} more to go live</span>
                )}
                {isDraft && boostTotal >= ((org as { boost_threshold?: number | null }).boost_threshold ?? 0) && (
                  <span style={{ color: '#2d9a4e' }}> — threshold met</span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {!userBoostAmount ? (
                <button
                  type="button"
                  data-testid="boost-btn"
                  disabled={boosting}
                  onClick={async () => {
                    setBoosting(true);
                    try {
                      const r = await boostsApi.boost(id);
                      setBoostTotal(r.total);
                      setUserBoostAmount(1);
                      addToast('Proposal boosted', 'success');
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Failed to boost', 'error');
                    } finally {
                      setBoosting(false);
                    }
                  }}
                  style={{ fontSize: 13, padding: '0.3rem 0.9rem', cursor: 'pointer', background: '#111', color: '#fff', border: 'none', borderRadius: 4 }}
                >
                  {boosting ? 'Boosting…' : '↑ Boost'}
                </button>
              ) : (
                <button
                  type="button"
                  data-testid="unboost-btn"
                  disabled={boosting}
                  onClick={async () => {
                    setBoosting(true);
                    try {
                      const r = await boostsApi.unboost(id);
                      setBoostTotal(r.total);
                      setUserBoostAmount(null);
                      addToast('Boost removed', 'info');
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Failed to remove boost', 'error');
                    } finally {
                      setBoosting(false);
                    }
                  }}
                  style={{ fontSize: 13, padding: '0.3rem 0.9rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd', borderRadius: 4, color: '#888' }}
                >
                  Remove boost
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Sentiment poll */}
      {features.sentiment && predictionMarket && currentUser && myMembership && !isDiscussion && (
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.75rem 1.25rem', marginBottom: '1.5rem', background: '#f9f9f9' }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: '0.5rem' }}>Community Sentiment</div>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.75rem', fontSize: 13 }}>
            <span style={{ color: '#2d9a4e' }}>
              Will pass: {predictionMarket.pass_count}
              {predictionMarket.pass_count > 0 && <span style={{ color: '#888' }}> ({predictionMarket.pass_confidence}% avg confidence)</span>}
            </span>
            <span style={{ color: '#c0392b' }}>
              Will fail: {predictionMarket.fail_count}
              {predictionMarket.fail_count > 0 && <span style={{ color: '#888' }}> ({predictionMarket.fail_confidence}% avg confidence)</span>}
            </span>
          </div>
          {(isOpen || isDraft) && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {!predictionMarket.user_prediction ? (
                <>
                  <span style={{ fontSize: 12, color: '#666' }}>What do you expect?</span>
                  <button
                    type="button"
                    disabled={predicting}
                    onClick={async () => {
                      setPredicting(true);
                      try {
                        const r = await predictionsApi.predict(id, 'pass', 70);
                        setPredictionMarket((m) => m ? { ...m, user_prediction: r, pass_count: m.pass_count + 1 } : m);
                      } catch (err) {
                        addToast(err instanceof Error ? err.message : 'Failed to submit', 'error');
                      } finally {
                        setPredicting(false);
                      }
                    }}
                    style={{ fontSize: 12, padding: '0.25rem 0.75rem', cursor: 'pointer', background: '#2d9a4e', color: '#fff', border: 'none', borderRadius: 4 }}
                  >
                    Will pass
                  </button>
                  <button
                    type="button"
                    disabled={predicting}
                    onClick={async () => {
                      setPredicting(true);
                      try {
                        const r = await predictionsApi.predict(id, 'fail', 70);
                        setPredictionMarket((m) => m ? { ...m, user_prediction: r, fail_count: m.fail_count + 1 } : m);
                      } catch (err) {
                        addToast(err instanceof Error ? err.message : 'Failed to submit', 'error');
                      } finally {
                        setPredicting(false);
                      }
                    }}
                    style={{ fontSize: 12, padding: '0.25rem 0.75rem', cursor: 'pointer', background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4 }}
                  >
                    Will fail
                  </button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 12, color: '#666' }}>
                    Your expectation: <strong style={{ color: predictionMarket.user_prediction.prediction === 'pass' ? '#2d9a4e' : '#c0392b' }}>
                      {predictionMarket.user_prediction.prediction === 'pass' ? 'Will pass' : 'Will fail'}
                    </strong>
                  </span>
                  <button
                    type="button"
                    disabled={predicting}
                    onClick={async () => {
                      setPredicting(true);
                      try {
                        await predictionsApi.unpredict(id);
                        const prev = predictionMarket.user_prediction!;
                        setPredictionMarket((m) => m ? {
                          ...m,
                          user_prediction: null,
                          pass_count: prev.prediction === 'pass' ? m.pass_count - 1 : m.pass_count,
                          fail_count: prev.prediction === 'fail' ? m.fail_count - 1 : m.fail_count,
                        } : m);
                      } catch (err) {
                        addToast(err instanceof Error ? err.message : 'Failed to remove', 'error');
                      } finally {
                        setPredicting(false);
                      }
                    }}
                    style={{ fontSize: 12, padding: '0.25rem 0.75rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd', borderRadius: 4, color: '#888' }}
                  >
                    Remove
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Result banner */}
      {result && tally && !isDiscussion && (
        <div
          style={{
            border: `1px solid ${result === 'advisory' ? '#fed7aa' : result === 'blocked' ? '#f5c0c0' : tally.quorum_met === false && proposal.quorum_type !== 'hard' ? '#fde68a' : result === 'passed' ? '#b3e5c2' : result === 'failed' ? '#f5c0c0' : '#ddd'}`,
            borderRadius: 6,
            padding: '0.75rem 1.25rem',
            marginBottom: '1.5rem',
            background: result === 'advisory' ? '#fff7ed' : result === 'blocked' ? '#fdecea' : tally.quorum_met === false && proposal.quorum_type !== 'hard' ? '#fffbeb' : result === 'passed' ? '#e6f9ed' : result === 'failed' ? '#fdecea' : '#f5f5f5',
          }}
        >
          {result === 'advisory' ? (
            <>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#c2410c' }}>Temperature check — advisory only</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: 13, color: '#666' }}>
                {tally.yes + tally.no > 0
                  ? `${Math.round((tally.yes / (tally.yes + tally.no)) * 100)}% yes, ${Math.round((tally.no / (tally.yes + tally.no)) * 100)}% no — non-binding sentiment gauge`
                  : 'No votes yet.'}
              </p>
            </>
          ) : result === 'blocked' ? (
            <>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#d94040' }}>Blocked — requires discussion</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: 13, color: '#666' }}>
                {tally.no} member{tally.no !== 1 ? 's' : ''} raised a paramount objection.
              </p>
            </>
          ) : tally.quorum_met === false && proposal.quorum_type !== 'hard' ? (
            <>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: '#b45309' }}>Not quorate</p>
              <p style={{ margin: '0.25rem 0 0', fontSize: 13, color: '#666' }}>
                Only {tally.eligible_count && tally.eligible_count > 0 ? Math.round((tally.total / tally.eligible_count) * 100) : 0}% of members participated
                {' '}({proposal.quorum}% required) — result is non-binding
              </p>
            </>
          ) : (
            <>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: result === 'passed' ? '#2d9a4e' : result === 'failed' ? '#d94040' : '#888' }}>
                {result === 'passed' ? (isConsent ? 'Passes by consent' : 'Proposal passed') : result === 'failed' ? (tally.quorum_met === false ? 'Failed — quorum not met' : 'Proposal failed') : 'No decisive votes cast'}
              </p>
              {result !== 'no-votes' && !isConsent && (
                <p style={{ margin: '0.25rem 0 0', fontSize: 13, color: '#666' }}>
                  {tally.quorum_met === false
                    ? `${tally.eligible_count && tally.eligible_count > 0 ? Math.round((tally.total / tally.eligible_count) * 100) : 0}% of members participated (${proposal.quorum}% required)`
                    : `${Math.round((tally.yes / (tally.yes + tally.no)) * 100)}% yes (${threshold}% required to pass)`}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Outcome tracking (closed proposals, moderators only) */}
      {proposal.status === 'closed' && (
        <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          {proposal.outcome && (
            <span
              data-testid="outcome-badge"
              style={{
                fontSize: 12, fontWeight: 600, padding: '0.2rem 0.65rem', borderRadius: 12,
                border: '1px solid',
                color: proposal.outcome === 'implemented' ? '#1a7f37' : proposal.outcome === 'in_progress' ? '#b45309' : '#888',
                borderColor: proposal.outcome === 'implemented' ? '#1a7f37' : proposal.outcome === 'in_progress' ? '#b45309' : '#ccc',
              }}
            >
              {proposal.outcome === 'implemented' ? 'Implemented' : proposal.outcome === 'in_progress' ? 'In progress' : 'Not implemented'}
            </span>
          )}
          {isModerator && (
            <select
              value={proposal.outcome ?? ''}
              onChange={(e) => saveOutcome((e.target.value || null) as Proposal['outcome'])}
              disabled={savingOutcome}
              data-testid="outcome-select"
              style={{ fontSize: 12, padding: '0.2rem 0.5rem', border: '1px solid #ddd', borderRadius: 4, color: '#555', cursor: 'pointer' }}
            >
              <option value="">Set outcome…</option>
              <option value="implemented">Implemented</option>
              <option value="in_progress">In progress</option>
              <option value="not_implemented">Not implemented</option>
            </select>
          )}
        </div>
      )}

      {/* Vetoes */}
      {!isDiscussion && (vetoes.length > 0 || (canVeto && isOpen)) && (
        <div style={{ marginBottom: '1.5rem' }}>
          {vetoes.length > 0 && (
            <div style={{ border: '1px solid #f5c0c0', borderRadius: 6, padding: '0.75rem 1.25rem', background: '#fdecea', marginBottom: '0.75rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontWeight: 600, fontSize: 14, color: '#d94040' }}>
                {vetoes.length === 1 ? '1 veto in effect' : `${vetoes.length} vetoes in effect`} — this proposal cannot pass while vetoed
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {vetoes.map((v) => {
                  const vetoAuthor = userMap[v.author_id];
                  const isMyVeto = v.id === myVeto?.id;
                  const canRetract = isMyVeto || isModerator;
                  return (
                    <div key={v.id} data-testid="veto-item" style={{ fontSize: 13, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span>
                        <strong>{vetoAuthor?.name ?? 'Unknown'}</strong>: {v.reason}
                      </span>
                      {canRetract && (
                        <ConfirmButton
                          label="Retract"
                          confirmLabel="Yes"
                          onConfirm={() => retractVeto(v.id)}
                          style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer', flexShrink: 0 }}
                          confirmStyle={{ background: 'none', border: '1px solid #ddd', borderRadius: 3, color: '#d94040' }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {canVeto && isOpen && !myVeto && (
            showVetoForm ? (
              <form onSubmit={castVeto} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                <input
                  type="text"
                  placeholder="Reason for veto (required)"
                  value={vetoReason}
                  onChange={(e) => setVetoReason(e.target.value)}
                  autoFocus
                  style={{ flex: 1, padding: '0.35rem 0.5rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <button type="submit" disabled={castingVeto || !vetoReason.trim()} style={{ fontSize: 12, padding: '0.35rem 0.75rem', color: '#d94040', border: '1px solid #d94040', background: 'none', borderRadius: 4, cursor: 'pointer' }}>
                  {castingVeto ? 'Casting…' : 'Cast veto'}
                </button>
                <button type="button" onClick={() => setShowVetoForm(false)} style={{ fontSize: 12, padding: '0.35rem 0.75rem', background: 'none', border: '1px solid #ddd', borderRadius: 4, cursor: 'pointer' }}>
                  Cancel
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setShowVetoForm(true)}
                data-testid="cast-veto-btn"
                style={{ fontSize: 12, padding: '0.35rem 0.75rem', color: '#d94040', border: '1px solid #d94040', background: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Cast veto
              </button>
            )
          )}
        </div>
      )}

      {/* Tally */}
      {isTemperatureCheck && isOpen && (
        <div style={{ border: '1px solid #fed7aa', borderRadius: 6, padding: '0.6rem 1rem', marginBottom: '1rem', background: '#fff7ed' }}>
          <p style={{ margin: 0, fontSize: 13, color: '#c2410c' }}>This is a non-binding temperature check — results are advisory only and do not constitute a formal decision.</p>
        </div>
      )}
      {!isDiscussion && !isPetition && <div
        style={{
          border: '1px solid #ddd',
          borderRadius: 6,
          padding: '1rem 1.25rem',
          marginBottom: '1.5rem',
          background: '#fafafa',
        }}
      >
        <h3 style={{ margin: '0 0 1rem', fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {isTemperatureCheck ? 'Sentiment (non-binding)' : 'Results'}
        </h3>
        {org.voting_visibility === 'hidden' && isOpen && !isDeliberating ? (
          <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>Vote counts are hidden until this proposal closes</p>
        ) : tallyLoading ? (
          <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>Loading tally…</p>
        ) : tally ? (
          <>
            {isScoreVoting ? (
              <div>
                {tally.options.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>No options defined.</p>
                ) : (
                  [...tally.options]
                    .sort((a, b) => (b.mean_score ?? 0) - (a.mean_score ?? 0))
                    .map((opt, i) => {
                      const mean = opt.mean_score ?? 0;
                      const pct = Math.round((mean / 5) * 100);
                      const isLeader = i === 0 && mean > 0;
                      return (
                        <div key={opt.id} style={{ marginBottom: '0.6rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                            <span style={{ fontWeight: isLeader ? 600 : 400 }}>{opt.text}{isLeader ? ' ✓' : ''}</span>
                            <span style={{ color: '#888' }}>{mean.toFixed(2)} / 5 ({opt.count} voter{opt.count !== 1 ? 's' : ''})</span>
                          </div>
                          <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: isLeader ? '#2d9a4e' : '#3358c4', transition: 'width 0.3s' }} />
                          </div>
                        </div>
                      );
                    })
                )}
                <p style={{ margin: '0.5rem 0 0', fontSize: 12, color: '#aaa' }}>{tally.total} voter{tally.total !== 1 ? 's' : ''} participated</p>
              </div>
            ) : isRankedChoice ? (
              <div>
                {tally.options.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>No options defined.</p>
                ) : (() => {
                  const winner = tally.options.find((o) => o.mean_score === 1);
                  const lastRound = tally.options[0]?.irv_rounds?.[tally.options[0].irv_rounds.length - 1];
                  const sortedOptions = [...tally.options].sort((a, b) => (b.count) - (a.count));
                  return (
                    <>
                      {winner && (
                        <p style={{ margin: '0 0 0.75rem', fontSize: 14, color: '#2d9a4e', fontWeight: 600 }}>
                          Winner: {winner.text}
                        </p>
                      )}
                      <div style={{ marginBottom: '0.75rem' }}>
                        {sortedOptions.map((opt) => {
                          const isWinner = opt.mean_score === 1;
                          const finalCount = lastRound?.counts[opt.id] ?? opt.count;
                          const maxFinal = Math.max(...sortedOptions.map((o) => lastRound?.counts[o.id] ?? o.count), 1);
                          const pct = Math.round((finalCount / maxFinal) * 100);
                          return (
                            <div key={opt.id} style={{ marginBottom: '0.6rem' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                                <span style={{ fontWeight: isWinner ? 600 : 400 }}>{opt.text}{isWinner ? ' ✓' : ''}</span>
                                <span style={{ color: '#888' }}>{finalCount} vote{finalCount !== 1 ? 's' : ''}</span>
                              </div>
                              <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: isWinner ? '#2d9a4e' : '#3358c4', transition: 'width 0.3s' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {tally.options[0]?.irv_rounds && tally.options[0].irv_rounds.length > 1 && (
                        <details style={{ fontSize: 12, color: '#888' }}>
                          <summary style={{ cursor: 'pointer' }}>IRV rounds ({tally.options[0].irv_rounds.length})</summary>
                          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            {tally.options[0].irv_rounds.map((round, i) => (
                              <div key={i} style={{ padding: '0.4rem 0.6rem', background: '#f5f5f5', borderRadius: 4 }}>
                                <span style={{ fontWeight: 500 }}>Round {i + 1}</span>
                                {round.eliminated && <span style={{ color: '#d94040', marginLeft: '0.5rem' }}>eliminated: {tally.options.find((o) => o.id === round.eliminated)?.text ?? round.eliminated}</span>}
                                <span style={{ color: '#aaa', marginLeft: '0.5rem' }}>
                                  {Object.entries(round.counts).map(([optId, cnt]) => `${tally.options.find((o) => o.id === optId)?.text ?? optId}: ${cnt}`).join(', ')}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      <p style={{ margin: '0.5rem 0 0', fontSize: 12, color: '#aaa' }}>{tally.total} voter{tally.total !== 1 ? 's' : ''} participated</p>
                    </>
                  );
                })()}
              </div>
            ) : isMultipleChoice || isApproval ? (
              <div>
                {tally.options.length === 0 ? (
                  <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>No options defined.</p>
                ) : (
                  tally.options.map((opt) => {
                    const maxCount = Math.max(...tally.options.map((o) => o.count), 1);
                    const pct = isApproval ? Math.round((opt.count / maxCount) * 100) : (tally.total > 0 ? Math.round((opt.count / tally.total) * 100) : 0);
                    const isWinner = isApproval && tally.options.length > 0 && opt.count === maxCount && maxCount > 0;
                    return (
                      <div key={opt.id} style={{ marginBottom: '0.6rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                          <span style={{ fontWeight: isWinner ? 600 : 400 }}>{opt.text}{isWinner ? ' ✓' : ''}</span>
                          <span style={{ color: '#888' }}>
                            {isApproval
                              ? `${opt.count} approval${opt.count !== 1 ? 's' : ''}`
                              : `${opt.count} vote${opt.count !== 1 ? 's' : ''} (${pct}%)`}
                          </span>
                        </div>
                        <div style={{ height: 6, background: '#eee', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: isWinner ? '#2d9a4e' : '#3358c4', transition: 'width 0.3s' }} />
                        </div>
                      </div>
                    );
                  })
                )}
                <p style={{ margin: '0.5rem 0 0', fontSize: 12, color: '#aaa' }}>
                  {isApproval ? `${tally.total} voter${tally.total !== 1 ? 's' : ''} participated` : `${tally.total} vote${tally.total !== 1 ? 's' : ''} total`}
                </p>
              </div>
            ) : isConsent ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {([['yes', 'Consent', '#2d9a4e'], ['abstain', 'Stand Aside', '#888'], ['no', 'Block', '#d94040']] as [string, string, string][]).map(([choice, label, color]) => {
                  const count = choice === 'yes' ? tally.yes : choice === 'no' ? tally.no : tally.abstain;
                  return (
                    <div key={choice} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13 }}>
                      <span style={{ minWidth: 80, color, fontWeight: 600 }}>{label}</span>
                      <span style={{ color: '#555' }}>{count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <VoteTally tally={tally} />
            )}
            {tally.quorum_met !== null && tally.eligible_count != null && (
              <p style={{ margin: '0.75rem 0 0', fontSize: 12, color: tally.quorum_met ? '#2d9a4e' : '#b45309' }}>
                {tally.total} of {tally.eligible_count} member{tally.eligible_count !== 1 ? 's' : ''} participated
                {' '}({tally.eligible_count > 0 ? Math.round((tally.total / tally.eligible_count) * 100) : 0}% — {proposal.quorum}% quorum required)
                {tally.quorum_met ? ' — quorate' : ' — not quorate'}
              </p>
            )}
          </>
        ) : (
          <p style={{ fontSize: 13, color: '#aaa', margin: 0 }}>Could not load tally.</p>
        )}
      </div>}

      {/* Delegation carrying */}
      {!isDiscussion && !proposal.anonymous_voting && voteCarrying.length > 0 && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '1rem 1.25rem', marginBottom: '1.5rem', background: 'var(--color-bg-muted)' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: 14, color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Delegation carrying</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {voteCarrying.map(({ voter, carrying }) => (
              <div key={voter.user_id} style={{ fontSize: 13, color: 'var(--color-fg-muted)' }}>
                <strong style={{ color: 'var(--color-fg)' }}>{voter.name}</strong>
                {' '}carries {carrying.length} delegated vote{carrying.length !== 1 ? 's' : ''}
                {' '}on behalf of{' '}
                {carrying.map((d, i) => (
                  <span key={d.user_id}>
                    <strong style={{ color: 'var(--color-fg)' }}>{d.name}</strong>
                    {i < carrying.length - 2 ? ', ' : i === carrying.length - 2 ? ' and ' : ''}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Jury */}
      {(jury && jury.length > 0 || (isModerator && proposal.status === 'open' && !isDiscussion)) && (
        <div style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '1rem 1.25rem', marginBottom: '1.5rem', background: 'var(--color-bg-muted)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-3)', marginBottom: '0.75rem' }}>
            <h3 style={{ margin: 0, fontSize: 14, color: 'var(--color-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jury</h3>
            {isModerator && proposal.status === 'open' && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const size = parseInt(jurySize, 10);
                  if (!size || size < 1) return;
                  setSelectingJury(true);
                  try {
                    const selected = await proposalsApi.selectJury(id, size);
                    setJury(selected.map((m) => ({ ...m, has_voted: false })));
                    addToast(`Jury of ${selected.length} selected`, 'success');
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : 'Failed to select jury', 'error');
                  } finally {
                    setSelectingJury(false);
                  }
                }}
                style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}
              >
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={jurySize}
                  onChange={(e) => setJurySize(e.target.value)}
                  style={{ width: 52, padding: '0 var(--space-2)', height: 28, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
                />
                <button
                  type="submit"
                  disabled={selectingJury}
                  style={{ padding: '0 var(--space-3)', height: 28, fontSize: 'var(--text-sm)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}
                >
                  {selectingJury ? 'Selecting…' : jury && jury.length > 0 ? 'Reselect' : 'Select jury'}
                </button>
              </form>
            )}
          </div>
          {jury && jury.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {jury.map((j) => (
                <div key={j.user_id} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: j.has_voted ? '#16a34a' : '#d1d5db', flexShrink: 0 }} />
                  <span style={{ color: 'var(--color-fg)' }}>{j.name}</span>
                  {j.has_voted && <span style={{ fontSize: 11, color: '#16a34a' }}>voted</span>}
                </div>
              ))}
              <p style={{ fontSize: 12, color: 'var(--color-fg-muted)', margin: '0.5rem 0 0' }}>
                {jury.filter((j) => j.has_voted).length} / {jury.length} jury members have voted
              </p>
            </div>
          )}
        </div>
      )}

      {/* Constitutional outcome seal */}
      {constitutionalOutcome && (
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '1rem 1.25rem', marginBottom: '1.5rem', background: '#fafafa' }}>
          <p style={{ margin: '0 0 0.5rem', fontSize: 13, fontWeight: 600 }}>Constitutional outcome seal</p>
          <p style={{ margin: '0 0 0.25rem', fontSize: 12, color: '#555' }}>
            Outcome: <strong>{constitutionalOutcome.outcome}</strong> · signed {formatDatetime(constitutionalOutcome.signed_at)}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: '#888', fontFamily: 'monospace', wordBreak: 'break-all' }}>SHA-256: {constitutionalOutcome.hash}</p>
        </div>
      )}

      {/* Vote statements */}
      {!isDiscussion && !isPetition && org.voting_visibility !== 'hidden' && (() => {
        const proposalVotes = (allVotes ?? []).filter((v: Vote) => v.proposal_id === id && v.reason);
        if (proposalVotes.length === 0) return null;
        return (
          <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '1rem 1.25rem', marginBottom: '1.5rem', background: '#fafafa' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vote statements</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {proposalVotes.map((v: Vote) => {
                const voter = proposal.anonymous_voting ? null : (allUsers ?? []).find((u: User) => u.id === v.user_id);
                return (
                  <div key={v.id} data-testid="vote-statement" style={{ fontSize: 13, display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                    <span style={{ color: choiceColors[(v.choice as VoteChoice) ?? 'abstain'], fontWeight: 600, minWidth: 48, textTransform: 'capitalize' }}>
                    {isConsent
                      ? (v.choice === 'yes' ? 'Consent' : v.choice === 'no' ? 'Block' : 'Stand aside')
                      : (v.choice ?? 'voted')}
                  </span>
                    <span style={{ color: '#888' }}><strong style={{ color: '#444' }}>{proposal.anonymous_voting ? 'Anonymous member' : (voter?.name ?? 'Unknown')}</strong>: <em>{v.reason as string}</em></span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Vote action */}
      {!isDiscussion && isDeliberating && (
        <div style={{ border: '1px solid #ddd6fe', borderRadius: 6, padding: '0.75rem 1.25rem', background: '#faf5ff', marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#6d28d9', fontWeight: 500 }}>Deliberation phase — voting is not yet open.</p>
          <p style={{ margin: '0.25rem 0 0', fontSize: 13, color: '#888' }}>
            Use this time to read the arguments and discussion below. Voting opens {formatDatetime(proposal.deliberation_ends_at)}.
          </p>
        </div>
      )}
      {isPetition && isOpen && (
        <div style={{ border: '1px solid #fecdd3', borderRadius: 6, padding: '1rem 1.25rem', marginBottom: '1.5rem', background: '#fff1f2' }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: 14, color: '#be123c', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Petition
          </h3>
          {proposal.signature_threshold != null && (
            <div style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                <span style={{ color: '#555' }}>{signatureCount} / {proposal.signature_threshold} signatures</span>
                <span style={{ color: '#888' }}>{Math.min(100, Math.round((signatureCount / proposal.signature_threshold) * 100))}%</span>
              </div>
              <div style={{ height: 8, background: '#fecdd3', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, (signatureCount / proposal.signature_threshold) * 100)}%`, height: '100%', background: '#be123c', transition: 'width 0.3s' }} />
              </div>
              <p style={{ margin: '0.4rem 0 0', fontSize: 12, color: '#888' }}>
                {proposal.signature_threshold - signatureCount > 0
                  ? `${proposal.signature_threshold - signatureCount} more signature${proposal.signature_threshold - signatureCount !== 1 ? 's' : ''} needed to trigger a vote`
                  : 'Threshold reached'}
              </p>
            </div>
          )}
          {currentUser && myMembership && (
            <button
              onClick={handleSign}
              disabled={signing}
              style={{
                fontSize: 13,
                padding: '0.4rem 1.25rem',
                borderRadius: 4,
                border: `1px solid ${signatures.find((s) => s.user_id === currentUser.id) ? '#be123c' : '#be123c'}`,
                background: signatures.find((s) => s.user_id === currentUser.id) ? '#be123c' : 'none',
                color: signatures.find((s) => s.user_id === currentUser.id) ? '#fff' : '#be123c',
                cursor: 'pointer',
                marginBottom: '0.75rem',
              }}
            >
              {signing ? '…' : signatures.find((s) => s.user_id === currentUser.id) ? 'Remove signature' : 'Sign this petition'}
            </button>
          )}
          {signatures.length > 0 && (
            <div>
              <p style={{ fontSize: 12, color: '#888', margin: '0 0 0.3rem' }}>Signatories:</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {signatures.map((s) => {
                  const signer = (allUsers ?? []).find((u: User) => u.id === s.user_id);
                  return (
                    <span key={s.id || s.user_id} style={{ fontSize: 12, padding: '1px 8px', borderRadius: 10, background: '#fecdd3', color: '#be123c', border: '1px solid #fca5a5' }}>
                      {signer?.name ?? s.user_id}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
      {!isDiscussion && !isPetition && isOpen && !isDeliberating && (
        <div
          style={{
            border: '1px solid #ddd',
            borderRadius: 6,
            padding: '1rem 1.25rem',
          }}
        >
          <h3 style={{ margin: '0 0 0.75rem', fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your vote
          </h3>

          {/* Delegation override notice */}
          {features.delegation && currentUser && !myVote && delegationChain && (
            <div style={{
              background: '#f0f7ff',
              border: '1px solid #c3d6fb',
              borderRadius: 4,
              padding: '0.6rem 0.75rem',
              marginBottom: '0.75rem',
              fontSize: 13,
              color: '#444',
            }}>
              <div style={{ marginBottom: delegationChain.voter ? '0.3rem' : 0 }}>
                <span style={{ color: '#888', fontSize: 12 }}>Your vote flows: </span>
                {delegationChain.chain.map((link, i) => (
                  <span key={link.user_id}>
                    {i > 0 && <span style={{ color: '#aaa', margin: '0 0.2rem' }}>→</span>}
                    <strong>{i === 0 ? 'You' : link.name}</strong>
                  </span>
                ))}
                {delegationChain.voter && (() => {
                  const voterMembership = (allMemberships ?? []).find((m: Membership) => m.organisation_id === org.id && m.user_id === delegationChain.voter!.user_id);
                  const orgWeightMode = (org as { weight_mode?: string }).weight_mode ?? 'manual';
                  const ROLE_W: Record<string, number> = { admin: 3, moderator: 2, member: 1, observer: 0 };
                  const voterWeight = orgWeightMode === 'by_role'
                    ? (voterMembership ? (ROLE_W[voterMembership.role] ?? 1) : 1)
                    : (voterMembership ? ((voterMembership as { weight?: number }).weight ?? 1) : 1);
                  return (
                    <>
                      <span style={{ color: '#aaa', margin: '0 0.2rem' }}>→</span>
                      <strong>{delegationChain.voter.name}</strong>
                      {voterWeight !== 1 && <span style={{ marginLeft: 4, fontSize: 11, background: '#e8f0fe', color: '#1a56d6', padding: '1px 5px', borderRadius: 7 }}>×{voterWeight}</span>}
                      {' '}voted{' '}
                      <strong style={{ color: choiceColors[delegationChain.voter.choice as VoteChoice] }}>
                        {delegationChain.voter.choice}
                      </strong>
                    </>
                  );
                })()}
                {!delegationChain.voter && (
                  <span style={{ color: '#888' }}> — delegate hasn't voted yet</span>
                )}
              </div>
              <span style={{ fontSize: 12, color: '#888' }}>Cast your own vote below to override.</span>
            </div>
          )}

          {features.delegation && delegationSuggestions.length > 0 && (
            <div style={{ background: '#f5f9ff', border: '1px solid #c3d6fb', borderRadius: 4, padding: '0.6rem 0.75rem', marginBottom: '0.75rem', fontSize: 13 }}>
              <p style={{ margin: '0 0 0.4rem', color: '#555' }}>Suggested delegates (high participation):</p>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {delegationSuggestions.map((s: { userId: string; pct: number }) => {
                  const suggestedUser = userMap[s.userId];
                  if (!suggestedUser) return null;
                  return (
                    <Link
                      key={s.userId}
                      to="/orgs/$slug/delegations"
                      params={{ slug: org.slug }}
                      style={{ fontSize: 12, color: '#1a56d6', textDecoration: 'none', padding: '0.2rem 0.6rem', border: '1px solid #c3d6fb', borderRadius: 12, background: '#fff' }}
                    >
                      {suggestedUser.name} ({s.pct}%)
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {!currentUser ? (
            <p style={{ fontSize: 14, color: '#666' }}>
              Please sign in to vote on this proposal.
            </p>
          ) : myVote && !changingVote ? (
            <div>
              <p style={{ margin: '0 0 0.5rem', fontSize: 14 }}>
                {isApproval ? (
                  <>You approved <strong>{myApprovalVotes.length}</strong> option{myApprovalVotes.length !== 1 ? 's' : ''}.</>
                ) : isScoreVoting ? (
                  <>You rated <strong>{myApprovalVotes.length}</strong> option{myApprovalVotes.length !== 1 ? 's' : ''}.</>
                ) : isRankedChoice ? (
                  <>You ranked <strong>{myApprovalVotes.length}</strong> option{myApprovalVotes.length !== 1 ? 's' : ''}.</>
                ) : isMultipleChoice ? (
                  <>You voted for <strong>{proposalOptions.find((o) => o.id === myVote.option_id)?.text ?? 'unknown option'}</strong>.</>
                ) : isConsent ? (
                  <>You <strong style={{ color: myVote.choice === 'yes' ? '#2d9a4e' : myVote.choice === 'no' ? '#d94040' : '#888' }}>
                    {myVote.choice === 'yes' ? 'consented' : myVote.choice === 'no' ? 'blocked' : 'stood aside'}
                  </strong>.</>
                ) : (
                  <>You voted <strong style={{ color: choiceColors[myVote.choice as VoteChoice] }}>{myVote.choice}</strong>.</>
                )}
              </p>
              {myVote.reason && (
                <p data-testid="my-vote-reason" style={{ margin: '0 0 0.75rem', fontSize: 13, color: '#555', fontStyle: 'italic' }}>
                  "{myVote.reason}"
                </p>
              )}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  onClick={() => { setChangingVote(true); setVoteReason((myVote.reason as string) ?? ''); }}
                  disabled={voting}
                  style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer' }}
                >
                  Change vote
                </button>
                <ConfirmButton
                  label="Remove vote"
                  confirmLabel="Yes, remove"
                  onConfirm={removeVote}
                  disabled={voting}
                  style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', color: '#d94040', border: '1px solid #d94040', background: 'none' }}
                  confirmStyle={{ color: '#d94040', border: '1px solid #d94040', background: 'none', borderRadius: 4 }}
                />
                {!proposal.anonymous_voting && (
                  <button
                    onClick={async () => {
                      try {
                        const receipt = await proposalsApi.getReceipt(id);
                        const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `vote-receipt-${id.slice(0, 8)}.json`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch {
                        addToast('Failed to download receipt', 'error');
                      }
                    }}
                    style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', color: 'var(--color-fg-muted)', background: 'none', border: '1px solid var(--color-border)', borderRadius: 4 }}
                  >
                    Download receipt
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div>
              {changingVote && (
                <p style={{ margin: '0 0 0.75rem', fontSize: 13, color: '#666' }}>
                  Choose a new vote:
                </p>
              )}
              {isApproval ? (
                <div>
                  <p style={{ margin: '0 0 0.5rem', fontSize: 13, color: '#666' }}>Select all options you approve of:</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
                    {proposalOptions.map((opt) => {
                      const checked = approvalSelections.has(opt.id);
                      return (
                        <label
                          key={opt.id}
                          style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: 14, cursor: 'pointer', padding: '0.4rem 0.75rem', border: `1px solid ${checked ? '#3358c4' : '#ddd'}`, borderRadius: 4, background: checked ? '#f0f4ff' : '#fafafa' }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const next = new Set(approvalSelections);
                              if (checked) next.delete(opt.id); else next.add(opt.id);
                              setApprovalSelections(next);
                            }}
                          />
                          {opt.text}
                        </label>
                      );
                    })}
                  </div>
                  <button
                    onClick={submitApprovals}
                    disabled={submittingApprovals}
                    style={{ fontSize: 13, padding: '0.35rem 1rem', cursor: 'pointer', background: '#3358c4', color: '#fff', border: 'none', borderRadius: 4 }}
                  >
                    {submittingApprovals ? 'Saving…' : 'Save approvals'}
                  </button>
                </div>
              ) : isScoreVoting ? (
                <div>
                  <p style={{ margin: '0 0 0.5rem', fontSize: 13, color: '#666' }}>Rate each option 0–5 (0 = worst, 5 = best):</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginBottom: '0.75rem' }}>
                    {proposalOptions.map((opt) => (
                      <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ fontSize: 13, flex: 1 }}>{opt.text}</span>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          {[0, 1, 2, 3, 4, 5].map((s) => (
                            <button
                              key={s}
                              onClick={() => setScoreMap((prev) => ({ ...prev, [opt.id]: s }))}
                              style={{
                                width: 32, height: 32, fontSize: 13, cursor: 'pointer',
                                border: '1px solid #ddd', borderRadius: 4,
                                background: (scoreMap[opt.id] ?? -1) === s ? '#3358c4' : '#f5f5f5',
                                color: (scoreMap[opt.id] ?? -1) === s ? '#fff' : '#333',
                              }}
                            >{s}</button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={submitScores}
                    disabled={submittingScores}
                    style={{ fontSize: 13, padding: '0.35rem 1rem', cursor: 'pointer', background: '#3358c4', color: '#fff', border: 'none', borderRadius: 4 }}
                  >
                    {submittingScores ? 'Saving…' : 'Save scores'}
                  </button>
                </div>
              ) : isRankedChoice ? (
                <div>
                  <p style={{ margin: '0 0 0.5rem', fontSize: 13, color: '#666' }}>Drag to rank options (1st = most preferred):</p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '0.75rem' }}>
                    {(() => {
                      const ranked = rankOrder.map((optId) => proposalOptions.find((o) => o.id === optId)).filter(Boolean);
                      const unranked = proposalOptions.filter((o) => !rankOrder.includes(o.id));
                      const all = [...ranked, ...unranked];
                      return all.map((opt, i) => {
                        if (!opt) return null;
                        const isInRanking = rankOrder.includes(opt.id);
                        return (
                          <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span style={{ minWidth: 24, fontSize: 12, color: isInRanking ? '#3358c4' : '#aaa', fontWeight: 600 }}>{isInRanking ? `${rankOrder.indexOf(opt.id) + 1}.` : '—'}</span>
                            <div style={{ flex: 1, padding: '0.4rem 0.75rem', border: `1px solid ${isInRanking ? '#3358c4' : '#ddd'}`, borderRadius: 4, background: isInRanking ? '#f0f4ff' : '#fafafa', fontSize: 13 }}>
                              {opt.text}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <button aria-label="Move option up" onClick={() => {
                                if (!isInRanking) { setRankOrder((prev) => [...prev, opt.id]); return; }
                                const idx = rankOrder.indexOf(opt.id);
                                if (idx > 0) { const next = [...rankOrder]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; setRankOrder(next); }
                              }} style={{ fontSize: 10, padding: '1px 4px', cursor: 'pointer', border: '1px solid #ddd', background: 'none', borderRadius: 2 }}>▲</button>
                              <button aria-label="Move option down" onClick={() => {
                                if (!isInRanking) return;
                                const idx = rankOrder.indexOf(opt.id);
                                if (idx < rankOrder.length - 1) { const next = [...rankOrder]; [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]; setRankOrder(next); }
                                else { setRankOrder((prev) => prev.filter((x) => x !== opt.id)); }
                              }} style={{ fontSize: 10, padding: '1px 4px', cursor: 'pointer', border: '1px solid #ddd', background: 'none', borderRadius: 2 }}>▼</button>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                  <button
                    onClick={submitRankings}
                    disabled={submittingRankings || rankOrder.length === 0}
                    style={{ fontSize: 13, padding: '0.35rem 1rem', cursor: 'pointer', background: '#3358c4', color: '#fff', border: 'none', borderRadius: 4 }}
                  >
                    {submittingRankings ? 'Saving…' : 'Save rankings'}
                  </button>
                </div>
              ) : isMultipleChoice ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  <textarea
                    data-testid="vote-reason-input"
                    aria-label="Vote reason (optional)"
                    placeholder="Add a reason (optional)"
                    value={voteReason}
                    onChange={(e) => setVoteReason(e.target.value)}
                    rows={2}
                    className={styles.voteReason}
                  />
                  {proposalOptions.map((opt) => (
                    <button
                      key={opt.id}
                      data-testid={`vote-option-${opt.id}`}
                      onClick={() => myVote ? changeVote(null, opt.id) : castVote(null, opt.id)}
                      disabled={voting}
                      style={{
                        fontSize: 13,
                        padding: '0.4rem 1rem',
                        cursor: 'pointer',
                        background: myVote?.option_id === opt.id ? '#3358c4' : '#f5f5f5',
                        color: myVote?.option_id === opt.id ? '#fff' : '#333',
                        border: '1px solid #ddd',
                        borderRadius: 4,
                        textAlign: 'left',
                      }}
                    >
                      {opt.text}
                    </button>
                  ))}
                  {changingVote && (
                    <button
                      onClick={() => setChangingVote(false)}
                      style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd', alignSelf: 'flex-start' }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <textarea
                    data-testid="vote-reason-input"
                    aria-label="Vote reason (optional)"
                    placeholder="Add a reason (optional)"
                    value={voteReason}
                    onChange={(e) => setVoteReason(e.target.value)}
                    rows={2}
                    className={styles.voteReason}
                  />
                  {(proposal as any).quadratic_voting && (
                    <div style={{ margin: '0.5rem 0', fontSize: 13, color: 'var(--color-fg-muted)' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span>Votes to cast: <strong style={{ color: 'var(--color-fg)' }}>{voteCount}</strong></span>
                        <span style={{ color: '#888' }}>(cost: {voteCount * voteCount} credits)</span>
                      </label>
                      <input
                        type="range"
                        min={1}
                        max={10}
                        value={voteCount}
                        onChange={(e) => setVoteCount(parseInt(e.target.value, 10))}
                        style={{ width: '100%' }}
                      />
                    </div>
                  )}
                  <div className={styles.voteButtons}>
                    {(isConsent
                      ? [['yes', 'Consent'], ['abstain', 'Stand Aside'], ['no', 'Block']] as [VoteChoice, string][]
                      : (['yes', 'no', 'abstain'] as VoteChoice[]).map((c) => [c, c] as [VoteChoice, string])
                    ).map(([choice, label]) => {
                      const btnCls = [
                        styles.voteBtn,
                        choice === 'yes' ? styles.voteBtnYes : '',
                        choice === 'no' ? (isConsent ? styles.voteBtnBlock : styles.voteBtnNo) : '',
                        choice === 'abstain' ? styles.voteBtnAbstain : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <button
                          key={choice}
                          onClick={() => (myVote ? changeVote(choice) : castVote(choice))}
                          disabled={voting}
                          className={btnCls}
                        >
                          {label}
                        </button>
                      );
                    })}
                    {changingVote && (
                      <Button variant="secondary" size="md" onClick={() => setChangingVote(false)}>Cancel</Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Natural language vote */}
          {isOpen && currentUser && !myVote && (
            <div style={{ marginTop: '1rem', borderTop: '1px solid #f0f0f0', paddingTop: '1rem' }}>
              {!interpretedVote ? (
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  if (!nlVoteInput.trim()) return;
                  setInterpretingVote(true);
                  try {
                    const r = await aiApi.interpretVote(id, nlVoteInput);
                    setInterpretedVote(r);
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : 'Failed to interpret', 'error');
                  } finally {
                    setInterpretingVote(false);
                  }
                }}>
                  <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: '0.4rem' }}>&#10022; Or describe your vote in your own words</label>
                  <div style={{ display: 'flex', gap: '0.4rem' }}>
                    <input
                      type="text"
                      value={nlVoteInput}
                      onChange={(e) => setNlVoteInput(e.target.value)}
                      placeholder="e.g. I think this is too expensive but the idea is good…"
                      style={{ flex: 1, padding: '0.35rem 0.6rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
                    />
                    <button type="submit" disabled={interpretingVote || !nlVoteInput.trim()} style={{ fontSize: 12, padding: '0.35rem 0.75rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#555' }}>
                      {interpretingVote ? '…' : '→'}
                    </button>
                  </div>
                </form>
              ) : (
                <div style={{ background: '#f7f7f7', border: '1px solid #eee', borderRadius: 6, padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>AI interpreted your vote as</div>
                  <div style={{ fontSize: 14, marginBottom: '0.5rem' }}>
                    <strong style={{ color: interpretedVote.choice === 'yes' ? '#2d9a4e' : interpretedVote.choice === 'no' ? '#c0392b' : '#888' }}>
                      {interpretedVote.choice.charAt(0).toUpperCase() + interpretedVote.choice.slice(1)}
                    </strong>
                    {interpretedVote.rationale && <span style={{ color: '#555', fontSize: 13 }}> — {interpretedVote.rationale}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        setVoteReason(interpretedVote.rationale ?? '');
                        castVote(interpretedVote.choice);
                        setInterpretedVote(null);
                        setNlVoteInput('');
                      }}
                      style={{ fontSize: 12, padding: '0.3rem 0.8rem', background: '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                    >
                      Confirm vote
                    </button>
                    <button type="button" onClick={() => { setInterpretedVote(null); }} style={{ fontSize: 12, padding: '0.3rem 0.8rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#888' }}>
                      Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {voteError && (
            <p style={{ color: '#d94040', fontSize: 13, margin: '0.75rem 0 0' }}>{voteError}</p>
          )}
        </div>
      )}

      {!isDiscussion && isWithdrawn && (
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.75rem 1.25rem', background: '#f9f9f9', marginBottom: '1.5rem' }}>
          <p style={{ margin: 0, fontSize: 14, color: '#888' }}>This proposal was withdrawn — voting is no longer available.</p>
        </div>
      )}

      {!isDiscussion && !isOpen && !isWithdrawn && (
        <p style={{ fontSize: 13, color: '#aaa' }}>This proposal is closed — voting is no longer available.</p>
      )}

      {/* Author/moderator management actions */}
      {(isAuthor || isModerator) && !isWithdrawn && (
        <div className={styles.manageSection}>
          <p className={styles.sectionHeader}>Manage</p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {isModerator && !isDiscussion && (
              <a
                href={`/api/proposals/${id}/tally/csv`}
                download={`votes-${id}.csv`}
                data-testid="export-csv"
                style={{ fontSize: 13, padding: '0.35rem 0.9rem', border: '1px solid #ddd', borderRadius: 4, color: '#555', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
              >
                Export CSV
              </a>
            )}
            {isModerator && isOpen && !isDiscussion && (
              <button
                data-testid="send-vote-reminder"
                onClick={() => handleAction('Vote reminder sent', () => proposalsApi.sendVoteReminder(id))}
                disabled={actioning}
                style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #ddd', background: 'none' }}
              >
                Send vote reminder
              </button>
            )}
            {isModerator && (
              <button
                data-testid={proposal.pinned ? 'unpin-proposal' : 'pin-proposal'}
                onClick={() => handleAction(
                  proposal.pinned ? 'Proposal unpinned' : 'Proposal pinned',
                  () => proposal.pinned ? proposalsApi.unpin(id) : proposalsApi.pin(id),
                )}
                disabled={actioning}
                style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #ddd', background: 'none' }}
              >
                {proposal.pinned ? 'Unpin' : 'Pin to top'}
              </button>
            )}
            {isOpen && (
              <ConfirmButton
                label="Close voting"
                confirmLabel="Yes, close"
                onConfirm={() => handleAction('Voting closed', () => proposalsApi.close(id))}
                disabled={actioning}
                style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #ddd', background: 'none' }}
              />
            )}
            {proposal.status === 'closed' && (
              <button
                onClick={() => handleAction('Proposal reopened', () => proposalsApi.reopen(id))}
                disabled={actioning}
                style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #ddd', background: 'none' }}
              >
                Reopen
              </button>
            )}
            <ConfirmButton
              label="Withdraw"
              confirmLabel="Yes, withdraw"
              onConfirm={() => handleAction('Proposal withdrawn', () => proposalsApi.withdraw(id))}
              disabled={actioning}
              style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', color: '#d94040', border: '1px solid #d94040', background: 'none' }}
              confirmStyle={{ color: '#d94040', border: '1px solid #d94040', background: 'none', borderRadius: 4 }}
            />
          </div>
          {actionError && (
            <p style={{ color: '#d94040', fontSize: 13, margin: '0.75rem 0 0' }}>{actionError}</p>
          )}
        </div>
      )}

      {/* Arguments */}
      {features.argumentation && <div style={{ marginTop: '2.5rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Arguments ({proposalArguments.length})
        </h3>
        {/* Argument clustering */}
        {currentUser && (forArguments.length + againstArguments.length >= 3) && (
          <div style={{ marginBottom: '1rem' }}>
            {!argumentClusters ? (
              <button
                type="button"
                disabled={clustering}
                onClick={async () => {
                  setClustering(true);
                  try {
                    const r = await aiApi.clusterArguments(id);
                    setArgumentClusters(r.clusters);
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : 'Failed to cluster', 'error');
                  } finally {
                    setClustering(false);
                  }
                }}
                style={{ fontSize: 12, padding: '0.2rem 0.6rem', border: '1px solid #ddd', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: '#888' }}
              >
                {clustering ? 'Analysing…' : '✦ Find themes'}
              </button>
            ) : (
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>AI Themes</span>
                  <button type="button" onClick={() => setArgumentClusters(null)} style={{ fontSize: 11, color: '#bbb', background: 'none', border: 'none', cursor: 'pointer' }}>&times;</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {argumentClusters.map((c, i) => (
                    <div key={i} style={{ border: '1px solid #eee', borderRadius: 6, padding: '0.6rem 0.9rem', background: '#fafafa' }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: '0.4rem' }}>{c.theme}</div>
                      {c.for_points.length > 0 && <div style={{ fontSize: 12, color: '#2d9a4e', marginBottom: '0.2rem' }}>{c.for_points.map((p, j) => <div key={j}>&uarr; {p}</div>)}</div>}
                      {c.against_points.length > 0 && <div style={{ fontSize: 12, color: '#c0392b' }}>{c.against_points.map((p, j) => <div key={j}>&darr; {p}</div>)}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
          {(['for', 'against'] as const).map((side) => {
            const items = side === 'for' ? forArguments : againstArguments;
            const color = side === 'for' ? '#1a7f37' : '#d94040';
            const label = side === 'for' ? 'For' : 'Against';
            return (
              <div key={side}>
                <p style={{ margin: '0 0 0.6rem', fontSize: 13, fontWeight: 600, color }}>{label}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                  {items.map((a: Argument) => {
                    const argAuthor = a.author_id ? userMap[a.author_id] : undefined;
                    const isOwn = currentUser?.id === a.author_id;
                    return (
                      <div
                        key={a.id}
                        data-testid={`argument-${side}`}
                        style={{ border: `1px solid ${side === 'for' ? '#d3f0da' : '#f5c0c0'}`, borderRadius: 6, padding: '0.6rem 0.75rem', fontSize: 13, color: '#333', lineHeight: 1.5 }}
                      >
                        <p style={{ margin: '0 0 0.3rem' }}>{a.body}</p>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, color: '#aaa' }}>{argAuthor?.name ?? 'Unknown'}</span>
                          {(isOwn || isModerator) && (
                            <ConfirmButton
                              label="Remove"
                              confirmLabel="Yes"
                              onConfirm={() => deleteArgument(a.id)}
                              style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                              confirmStyle={{ background: 'none', border: '1px solid #ddd', borderRadius: 3, color: '#d94040' }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                  {items.length === 0 && (
                    <p style={{ fontSize: 12, color: '#bbb', margin: 0 }}>No {label.toLowerCase()} arguments yet.</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {currentUser && isOpen && (
          <form onSubmit={postArgument} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(['for', 'against'] as const).map((s) => (
                <label key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="arg-side" value={s} checked={argSide === s} onChange={() => setArgSide(s)} />
                  <span style={{ color: s === 'for' ? '#1a7f37' : '#d94040', fontWeight: 600 }}>{s === 'for' ? 'For' : 'Against'}</span>
                </label>
              ))}
            </div>
            <textarea
              aria-label={argSide === 'against' ? 'Against argument' : 'For argument'}
              value={argBody}
              onChange={(e) => setArgBody(e.target.value.slice(0, 2000))}
              rows={2}
              placeholder={argSide === 'against' ? 'Add an against argument…' : 'Add a for argument…'}
              style={{ width: '100%', padding: '0.4rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', resize: 'vertical' }}
            />
            <div>
              <button
                type="submit"
                disabled={postingArg || !argBody.trim()}
                style={{ fontSize: 12, padding: '0.25rem 0.9rem', cursor: 'pointer' }}
              >
                {postingArg ? 'Adding…' : 'Add argument'}
              </button>
            </div>
          </form>
        )}
      </div>}

      {/* Related proposals (links) */}
      {(links.length > 0 || (currentUser && myMembership)) && (
        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: links.length > 0 || showLinkForm ? '0.75rem' : 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Related {links.length > 0 && `(${links.length})`}
            </h3>
            {currentUser && myMembership && !showLinkForm && (
              <button
                type="button"
                onClick={() => setShowLinkForm(true)}
                style={{ fontSize: 13, padding: '0.2rem 0.6rem', cursor: 'pointer', border: '1px solid #ddd', borderRadius: 4, background: 'none', color: '#666' }}
              >
                + Add link
              </button>
            )}
          </div>
          {links.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginBottom: showLinkForm ? '0.75rem' : 0 }}>
              {links.map((l) => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 13 }}>
                  <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 8, background: '#f0f0f0', color: '#666', border: '1px solid #ddd', whiteSpace: 'nowrap' }}>
                    {l.link_type.replace(/_/g, ' ')}
                  </span>
                  <Link
                    to="/orgs/$slug/proposals/$id"
                    params={{ slug: org.slug, id: l.other_proposal_id }}
                    style={{ color: '#1a56d6', textDecoration: 'none' }}
                  >
                    {l.other_proposal_title}
                  </Link>
                  <span style={{ fontSize: 11, color: '#aaa' }}>({l.other_proposal_status})</span>
                  {l.direction === 'outgoing' && currentUser && (
                    <button
                      type="button"
                      aria-label="Remove link"
                      onClick={() => handleRemoveLink(l.id)}
                      style={{ fontSize: 11, color: '#aaa', border: 'none', background: 'none', cursor: 'pointer', padding: '0 0.2rem' }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {showLinkForm && (
            <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: '0.75rem 1rem', background: '#fafafa' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={linkType}
                  onChange={(e) => setLinkType(e.target.value as typeof linkType)}
                  style={{ padding: '0.3rem 0.5rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
                >
                  <option value="supersedes">Supersedes</option>
                  <option value="related_to">Related to</option>
                  <option value="blocks">Blocks</option>
                  <option value="depends_on">Depends on</option>
                </select>
                <input
                  type="text"
                  value={linkTargetId}
                  onChange={(e) => setLinkTargetId(e.target.value)}
                  placeholder="Target proposal ID"
                  style={{ flex: 1, minWidth: 200, padding: '0.3rem 0.5rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <button
                  type="button"
                  onClick={handleAddLink}
                  disabled={addingLink || !linkTargetId.trim()}
                  style={{ fontSize: 13, padding: '0.3rem 0.75rem', cursor: 'pointer', background: '#222', color: '#fff', border: 'none', borderRadius: 4 }}
                >
                  {addingLink ? '…' : 'Link'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowLinkForm(false)}
                  style={{ fontSize: 13, padding: '0.3rem 0.75rem', cursor: 'pointer', border: '1px solid #ddd', background: 'none', borderRadius: 4, color: '#555' }}
                >
                  Cancel
                </button>
              </div>
              <p style={{ margin: '0.3rem 0 0', fontSize: 11, color: '#aaa' }}>Enter the UUID of the proposal you want to link to.</p>
            </div>
          )}
        </div>
      )}

      {/* Amendments */}
      {!isAmendment && isOpen && (
        <div style={{ marginTop: '2rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: pendingAmendments.length > 0 || showAmendForm ? '0.75rem' : 0 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Amendments {pendingAmendments.length > 0 && `(${pendingAmendments.length})`}
            </h3>
            {currentUser && myMembership && !showAmendForm && (
              <button
                type="button"
                onClick={() => { setShowAmendForm(true); setAmendText(proposal.description || ''); }}
                style={{ fontSize: 13, padding: '0.25rem 0.75rem', cursor: 'pointer', border: '1px solid #ddd', borderRadius: 4, background: 'none', color: '#555' }}
              >
                Propose amendment
              </button>
            )}
          </div>
          {pendingAmendments.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem' }}>
              {pendingAmendments.map((a: Proposal) => (
                <div key={a.id} style={{ border: '1px solid #fde68a', borderRadius: 6, padding: '0.6rem 1rem', background: '#fffbeb', fontSize: 13 }}>
                  <Link to="/orgs/$slug/proposals/$id" params={{ slug: org.slug, id: a.id }} style={{ fontWeight: 500, color: '#92400e', textDecoration: 'none' }}>
                    {a.title}
                  </Link>
                  <span style={{ marginLeft: '0.5rem', color: '#aaa', fontSize: 12 }}>
                    · proposed by {(allUsers ?? []).find((u: User) => u.id === a.author_id)?.name ?? 'unknown'}
                  </span>
                  {a.closes_at && (
                    <span style={{ marginLeft: '0.5rem', color: '#aaa', fontSize: 12 }}>
                      · vote closes {formatDate(a.closes_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {showAmendForm && (
            <div style={{ border: '1px solid #fde68a', borderRadius: 6, padding: '1rem 1.25rem', background: '#fffbeb', marginBottom: '1rem' }}>
              <p style={{ margin: '0 0 0.5rem', fontSize: 13, color: '#92400e' }}>Proposed new description (members will vote on this amendment):</p>
              <textarea
                aria-label="Proposed new description"
                value={amendText}
                onChange={(e) => setAmendText(e.target.value)}
                rows={6}
                style={{ width: '100%', padding: '0.5rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', resize: 'vertical', marginBottom: '0.5rem' }}
                placeholder="Write the proposed new description..."
              />
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <label style={{ fontSize: 13, color: '#555' }}>Vote deadline:</label>
                <input
                  type="datetime-local"
                  value={amendDeadline}
                  onChange={(e) => setAmendDeadline(e.target.value)}
                  style={{ padding: '0.3rem 0.5rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
                />
                <button
                  type="button"
                  onClick={handleSubmitAmendment}
                  disabled={submittingAmend || !amendText.trim()}
                  style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', background: '#92400e', color: '#fff', border: 'none', borderRadius: 4 }}
                >
                  {submittingAmend ? 'Submitting…' : 'Submit amendment'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAmendForm(false)}
                  style={{ fontSize: 13, padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #ddd', background: 'none', borderRadius: 4, color: '#555' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Comments */}
      <div style={{ marginTop: '2.5rem', borderTop: '1px solid #eee', paddingTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem', fontSize: 14, color: '#555', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Discussion ({allProposalComments.length})
        </h3>

        {comments.length === 0 && (
          <EmptyState
            variant="comments"
            title="No comments yet"
            description={currentUser ? 'Be the first to share your thoughts.' : undefined}
          />
        )}

        {comments.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
            {comments.map((c: Comment) => {
              const commentAuthor = c.author_id ? userMap[c.author_id] : undefined;
              const isOwn = currentUser?.id === c.author_id;
              const isHidden = !!c.hidden_by;
              return (
                <div key={c.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: isHidden ? '#f0f0f0' : '#e8e8e8',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 13, fontWeight: 600, color: '#999', flexShrink: 0,
                  }}>
                    {isHidden ? '–' : (commentAuthor ? commentAuthor.name.charAt(0).toUpperCase() : '?')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isHidden ? (
                      <div style={{ fontSize: 13, color: '#aaa', fontStyle: 'italic', padding: '0.4rem 0' }}>
                        Comment removed by moderator
                        {c.hidden_reason && <span> — {c.hidden_reason}</span>}
                        {isModerator && (
                          <button
                            type="button"
                            onClick={() => unhideComment(c.id)}
                            style={{ marginLeft: '0.75rem', fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                          >
                            Unhide
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>
                            {commentAuthor?.name ?? 'Unknown'}
                          </span>
                          <span style={{ fontSize: 12, color: '#aaa' }}>
                            {formatDate(c.created_at)}
                          </span>
                          {c.pinned_at && (
                            <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>📌 Pinned</span>
                          )}
                          {c.edited_at && (
                            <span style={{ fontSize: 11, color: '#bbb' }}>(edited)</span>
                          )}
                          {(isOwn || isModerator || isAuthor) && editingCommentId !== c.id && hidingCommentId !== c.id && (
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: '0.25rem' }}>
                              {isOwn && (
                                <button
                                  type="button"
                                  data-testid="comment-edit-btn"
                                  onClick={() => { setEditingCommentId(c.id); setEditCommentBody(c.body); }}
                                  style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                                >
                                  Edit
                                </button>
                              )}
                              {(isModerator || isAuthor) && (
                                <button
                                  type="button"
                                  onClick={() => c.pinned_at ? unpinComment(c.id) : pinComment(c.id)}
                                  style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                                >
                                  {c.pinned_at ? 'Unpin' : 'Pin'}
                                </button>
                              )}
                              {isModerator && (
                                <button
                                  type="button"
                                  onClick={() => { setHidingCommentId(c.id); setHideReason(''); }}
                                  style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                                >
                                  Hide
                                </button>
                              )}
                              <ConfirmButton
                                label="Delete"
                                confirmLabel="Yes"
                                onConfirm={() => deleteComment(c.id)}
                                style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                                confirmStyle={{ background: 'none', border: '1px solid #ddd', borderRadius: 3, color: '#d94040' }}
                              />
                            </span>
                          )}
                        </div>
                        {editingCommentId === c.id ? (
                          <form onSubmit={(e) => saveEditComment(c.id, e)}>
                            <textarea
                              data-testid="comment-edit-textarea"
                              aria-label="Edit comment"
                              value={editCommentBody}
                              onChange={(e) => setEditCommentBody(e.target.value.slice(0, COMMENT_MAX))}
                              rows={3}
                              maxLength={COMMENT_MAX}
                              style={{ width: '100%', padding: '0.4rem', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', resize: 'vertical', marginBottom: '0.4rem' }}
                            />
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button type="submit" disabled={!editCommentBody.trim()} style={{ fontSize: 12, padding: '0.2rem 0.7rem', cursor: 'pointer' }}>Save</button>
                              <button type="button" onClick={() => setEditingCommentId(null)} style={{ fontSize: 12, padding: '0.2rem 0.7rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd' }}>Cancel</button>
                            </div>
                          </form>
                        ) : hidingCommentId === c.id ? (
                          <form onSubmit={(e) => hideComment(c.id, e)} style={{ marginTop: '0.25rem' }}>
                            <input
                              type="text"
                              placeholder="Reason for hiding (required)"
                              value={hideReason}
                              onChange={(e) => setHideReason(e.target.value)}
                              autoFocus
                              style={{ width: '100%', padding: '0.35rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', marginBottom: '0.35rem' }}
                            />
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button type="submit" disabled={!hideReason.trim()} style={{ fontSize: 12, padding: '0.2rem 0.7rem', cursor: 'pointer', color: '#d94040', border: '1px solid #d94040', background: 'none', borderRadius: 3 }}>Hide</button>
                              <button type="button" onClick={() => setHidingCommentId(null)} style={{ fontSize: 12, padding: '0.2rem 0.7rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd' }}>Cancel</button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div style={{ fontSize: 14, color: '#333', lineHeight: 1.5 }}>
                              <MarkdownContent content={translatedComments[c.id] ?? c.body} />
                            </div>
                            <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                              {currentUser && (
                                <button
                                  type="button"
                                  onClick={() => { setReplyingToId(replyingToId === c.id ? null : c.id); setReplyBody(''); }}
                                  style={{ fontSize: 11, padding: '1px 6px', border: '1px solid #e0e0e0', borderRadius: 10, background: 'transparent', cursor: 'pointer', color: '#555' }}
                                >
                                  Reply
                                </button>
                              )}
                              {currentUser && (
                                <button
                                  type="button"
                                  data-testid="quote-reply-btn"
                                  onClick={() => {
                                    const quoted = c.body.split('\n').map((l: string) => '> ' + l).join('\n') + '\n\n';
                                    setCommentBody(quoted);
                                    commentTextareaRef.current?.focus();
                                  }}
                                  style={{ fontSize: 11, padding: '1px 6px', border: '1px solid #e0e0e0', borderRadius: 10, background: 'transparent', cursor: 'pointer', color: '#555' }}
                                >
                                  Quote
                                </button>
                              )}
                              {browserLanguage && !translatedComments[c.id] && (
                                <button
                                  type="button"
                                  disabled={translatingComments.has(c.id)}
                                  onClick={async () => {
                                    setTranslatingComments((prev) => new Set(prev).add(c.id));
                                    try {
                                      const r = await aiApi.translate(c.body, browserLanguage);
                                      setTranslatedComments((prev) => ({ ...prev, [c.id]: r.translated }));
                                    } catch {
                                      // silent fail on comment translation
                                    } finally {
                                      setTranslatingComments((prev) => { const next = new Set(prev); next.delete(c.id); return next; });
                                    }
                                  }}
                                  style={{ fontSize: 11, padding: '1px 6px', border: '1px solid #e0e0e0', borderRadius: 10, background: 'transparent', cursor: 'pointer', color: '#aaa' }}
                                >
                                  {translatingComments.has(c.id) ? '…' : 'Translate'}
                                </button>
                              )}
                              {translatedComments[c.id] && (
                                <button
                                  type="button"
                                  onClick={() => setTranslatedComments((prev) => { const next = { ...prev }; delete next[c.id]; return next; })}
                                  style={{ fontSize: 11, padding: '1px 6px', border: '1px solid #e0e0e0', borderRadius: 10, background: 'transparent', cursor: 'pointer', color: '#aaa' }}
                                >
                                  Original
                                </button>
                              )}
                              {['👍', '👎', '❤️', '🤔'].map((emoji) => {
                                const reactionsForEmoji = (allReactions ?? []).filter(
                                  (r: CommentReaction) => r.comment_id === c.id && r.emoji === emoji,
                                );
                                const count = reactionsForEmoji.length;
                                const hasReacted = currentUser
                                  ? reactionsForEmoji.some((r: CommentReaction) => r.user_id === currentUser.id)
                                  : false;
                                if (count === 0 && !currentUser) return null;
                                return (
                                  <button
                                    key={emoji}
                                    type="button"
                                    onClick={() => currentUser && reactToComment(c.id, emoji)}
                                    title={currentUser ? (hasReacted ? 'Remove reaction' : `React with ${emoji}`) : 'Sign in to react'}
                                    style={{
                                      fontSize: 13, padding: '1px 6px',
                                      border: `1px solid ${hasReacted ? '#c3d6fb' : '#e0e0e0'}`,
                                      borderRadius: 10,
                                      background: hasReacted ? '#e8f0fe' : 'transparent',
                                      cursor: currentUser ? 'pointer' : 'default',
                                      opacity: count === 0 ? 0.35 : 1,
                                      display: 'inline-flex', alignItems: 'center', gap: '0.2rem', color: '#555',
                                    }}
                                  >
                                    {emoji}{count > 0 && <span style={{ fontSize: 11 }}>{count}</span>}
                                  </button>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </>
                    )}
                    {/* Threaded replies */}
                    {(repliesFor(c.id).length > 0 || replyingToId === c.id) && (
                      <div data-testid="replies-list" style={{ marginTop: '0.75rem', borderLeft: '2px solid #e8e8e8', paddingLeft: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {repliesFor(c.id).map((reply: Comment) => {
                          const replyAuthor = reply.author_id ? userMap[reply.author_id] : undefined;
                          const isOwnReply = currentUser?.id === reply.author_id;
                          return (
                            <div key={reply.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, color: '#999', flexShrink: 0 }}>
                                {replyAuthor ? replyAuthor.name.charAt(0).toUpperCase() : '?'}
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.2rem' }}>
                                  <span style={{ fontSize: 13, fontWeight: 600 }}>{replyAuthor?.name ?? 'Unknown'}</span>
                                  <span style={{ fontSize: 11, color: '#aaa' }}>{formatDate(reply.created_at)}</span>
                                  {(isOwnReply || isModerator) && (
                                    <span style={{ marginLeft: 'auto' }}>
                                      <ConfirmButton
                                        label="Delete"
                                        confirmLabel="Yes"
                                        onConfirm={() => deleteComment(reply.id)}
                                        style={{ fontSize: 11, padding: '0.1rem 0.4rem', color: '#aaa', border: '1px solid #e0e0e0', background: 'none', borderRadius: 3, cursor: 'pointer' }}
                                        confirmStyle={{ background: 'none', border: '1px solid #ddd', borderRadius: 3, color: '#d94040' }}
                                      />
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 13, color: '#333', lineHeight: 1.5 }}>
                                  <MarkdownContent content={reply.body} />
                                </div>
                              </div>
                            </div>
                          );
                        })}
                        {replyingToId === c.id && (
                          <form onSubmit={(e) => postReply(c.id, e)} style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                            <textarea
                              autoFocus
                              value={replyBody}
                              onChange={(e) => setReplyBody(e.target.value.slice(0, COMMENT_MAX))}
                              placeholder="Write a reply…"
                              rows={2}
                              style={{ flex: 1, padding: '0.35rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4, resize: 'vertical' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                              <button type="submit" disabled={!replyBody.trim()} style={{ fontSize: 12, padding: '0.25rem 0.6rem', cursor: 'pointer', background: '#111', color: '#fff', border: 'none', borderRadius: 4 }}>Post</button>
                              <button type="button" onClick={() => setReplyingToId(null)} style={{ fontSize: 12, padding: '0.25rem 0.6rem', cursor: 'pointer', background: 'none', border: '1px solid #ddd', borderRadius: 4 }}>Cancel</button>
                            </div>
                          </form>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {currentUser ? (
          <form onSubmit={postComment}>
            <div style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <label htmlFor="comment-body" style={{ fontSize: 13, color: '#555' }}>Add a comment</label>
                {commentBody.length > COMMENT_MAX - 500 && (
                  <span style={{ fontSize: 11, color: commentBody.length >= COMMENT_MAX ? '#d94040' : '#aaa' }}>
                    {COMMENT_MAX - commentBody.length} left
                  </span>
                )}
              </div>
              <MentionTextarea
                ref={commentTextareaRef}
                id="comment-body"
                data-testid="comment-body"
                value={commentBody}
                onChange={setCommentBody}
                orgSlug={org.slug}
                maxLength={COMMENT_MAX}
                rows={3}
                placeholder="Share your thoughts… Use @Name to mention members"
                style={{ width: '100%', padding: '0.5rem', fontSize: 14, border: '1px solid #ddd', borderRadius: 4, boxSizing: 'border-box', resize: 'vertical' }}
              />
            </div>
            <button
              type="submit"
              disabled={postingComment || !commentBody.trim()}
              style={{ fontSize: 13, padding: '0.35rem 1rem' }}
            >
              {postingComment ? 'Posting…' : 'Post comment'}
            </button>
          </form>
        ) : (
          <p style={{ fontSize: 14, color: '#888' }}>Sign in to join the discussion.</p>
        )}
      </div>
    </div>
  );
}
