import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from '@tanstack/react-db';
import { useOrg } from '../OrgContext';
import { useCurrentUser } from '../context';
import { usersCollection, membershipsCollection } from '../collections';
import { orgsApi, billingApi, slackApi, webhooksApi, apiKeysApi, proposalsApi, topicsApi, type AuditLogEntry, type Membership, type User, type Organisation, type OrgAnalytics, type WebhookEndpoint, type ApiKeyRecord, type Topic, type OrgType, type OrgFeatures, DEFAULT_FEATURES } from '../api';
import { formatDate, formatDatetime } from '../utils/format';
import { ConfirmButton } from '../components/ConfirmButton';
import { useToast } from '../components/Toast';
import { Button } from '../components/ui';
import styles from './AdminPage.module.css';

type CreationRole = 'member' | 'moderator' | 'admin';

const ROLE_LABELS: Record<CreationRole, string> = {
  member: 'Any member',
  moderator: 'Moderator and above',
  admin: 'Admin only',
};

const FEATURE_DEFS = [
  { key: 'delegation',      label: 'Delegation',       desc: 'Members can delegate their vote to a trusted representative.' },
  { key: 'advanced_voting', label: 'Advanced voting',  desc: 'Weighted, quadratic, ranked choice, approval, and conviction voting types.' },
  { key: 'argumentation',   label: 'Argumentation',    desc: 'For/against argument threads on each proposal.' },
  { key: 'proposal_queue',  label: 'Proposal queue',   desc: 'Draft proposals can be boosted by members to promote them to a live vote.' },
  { key: 'sentiment',       label: 'Sentiment poll',   desc: 'Members predict pass/fail before the vote closes as a community signal.' },
] as const;

export function AdminPage() {
  const { org, collections: { topicsCollection } } = useOrg();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const addToast = useToast();

  const { data: allMemberships } = useLiveQuery(membershipsCollection);
  const { data: allUsers } = useLiveQuery(usersCollection);
  const orgMembers = (allMemberships ?? []).filter((m: Membership) => m.organisation_id === org.id);
  const myMembership = currentUser
    ? orgMembers.find((m: Membership) => m.user_id === currentUser.id)
    : undefined;
  const isAdmin = myMembership?.role === 'admin';
  const usersById = new Map<string, User>((allUsers ?? []).map((u: User) => [u.id, u]));

  const [name, setName] = useState(org.name);
  const [description, setDescription] = useState(org.description);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [primaryColor, setPrimaryColor] = useState<string>(org.primary_color ?? '');
  const [logoUrl, setLogoUrl] = useState<string>(org.logo_url ?? '');
  const [savingBranding, setSavingBranding] = useState(false);

  const [proposalCreationRole, setProposalCreationRole] = useState<CreationRole>(org.proposal_creation_role ?? 'member');
  const [topicCreationRole, setTopicCreationRole] = useState<CreationRole>(org.topic_creation_role ?? 'member');
  const [savingRole, setSavingRole] = useState(false);

  const [votingVisibility, setVotingVisibility] = useState<'public' | 'hidden'>(org.voting_visibility ?? 'public');
  const [savingVisibility, setSavingVisibility] = useState(false);

  const [defaultDuration, setDefaultDuration] = useState<string>(
    org.default_voting_duration_days != null ? String(org.default_voting_duration_days) : '',
  );
  const [defaultThreshold, setDefaultThreshold] = useState<string>(String(org.default_threshold ?? 50));
  const [defaultQuorum, setDefaultQuorum] = useState<string>(
    org.default_quorum != null ? String(org.default_quorum) : '',
  );
  const [isPublic, setIsPublic] = useState<boolean>(org.is_public ?? false);
  const [savingPublic, setSavingPublic] = useState(false);
  const [vetoRole, setVetoRole] = useState<'moderator' | 'admin'>((org as { veto_role?: 'moderator' | 'admin' }).veto_role ?? 'admin');
  const [savingVetoRole, setSavingVetoRole] = useState(false);
  const [minEndorsements, setMinEndorsements] = useState<string>(String((org as { min_endorsements?: number }).min_endorsements ?? 0));
  const [savingEndorsements, setSavingEndorsements] = useState(false);
  const [boostThreshold, setBoostThreshold] = useState<string>(
    (org as { boost_threshold?: number | null }).boost_threshold != null
      ? String((org as { boost_threshold?: number | null }).boost_threshold)
      : '',
  );
  const [savingBoostThreshold, setSavingBoostThreshold] = useState(false);
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsError, setDefaultsError] = useState('');

  const [requireApproval, setRequireApproval] = useState<boolean>((org as { require_member_approval?: boolean }).require_member_approval ?? false);
  const [savingApproval, setSavingApproval] = useState(false);
  const [allowedDomains, setAllowedDomains] = useState<string>((org.allowed_email_domains ?? []).join(', '));
  const [savingDomains, setSavingDomains] = useState(false);
  const [weightMode, setWeightMode] = useState<'manual' | 'by_role'>((org as { weight_mode?: 'manual' | 'by_role' }).weight_mode ?? 'manual');
  const [savingWeightMode, setSavingWeightMode] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const [transferToId, setTransferToId] = useState('');
  const [transferring, setTransferring] = useState(false);

  type ProposalTemplate = Organisation['proposal_templates'][number];
  const orgTemplates: ProposalTemplate[] = (org as { proposal_templates?: ProposalTemplate[] }).proposal_templates ?? [];
  const [templates, setTemplates] = useState<ProposalTemplate[]>(orgTemplates);
  const [newTmplName, setNewTmplName] = useState('');
  const [newTmplDescription, setNewTmplDescription] = useState('');
  const [newTmplType, setNewTmplType] = useState<'standard' | 'discussion' | 'multiple_choice'>('standard');
  const [newTmplThreshold, setNewTmplThreshold] = useState<number>(50);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const [deleting, setDeleting] = useState(false);

  const [inviteEmail, setInviteEmail] = useState('');
  const [sendingInvite, setSendingInvite] = useState(false);
  const [pendingInvites, setPendingInvites] = useState<import('../api').OrgInvite[]>([]);
  const [cancellingInviteId, setCancellingInviteId] = useState<string | null>(null);

  const { data: allTopics } = useLiveQuery(topicsCollection);
  const orgTopics = (allTopics ?? []).filter((t: Topic) => t.organisation_id === org.id);
  const [togglingConstitutional, setTogglingConstitutional] = useState<string | null>(null);

  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLogLoading, setAuditLogLoading] = useState(true);
  const [analytics, setAnalytics] = useState<OrgAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [billingStatus, setBillingStatus] = useState<{ plan: 'free' | 'pro' | 'nonprofit'; memberCount: number; memberLimit: number | null; canUpgrade: boolean } | null>(null);
  const [nonprofitName, setNonprofitName] = useState('');
  const [nonprofitRegNumber, setNonprofitRegNumber] = useState('');
  const [nonprofitCountry, setNonprofitCountry] = useState('');
  const [applyingNonprofit, setApplyingNonprofit] = useState(false);
  const [upgradingToStripe, setUpgradingToStripe] = useState(false);
  const [managingBilling, setManagingBilling] = useState(false);
  const [slackChannels, setSlackChannels] = useState<Array<{ id: string; name: string }> | null>(null);
  const [selectedSlackChannel, setSelectedSlackChannel] = useState('');
  const [savingSlackChannel, setSavingSlackChannel] = useState(false);
  const [connectingSlack, setConnectingSlack] = useState(false);
  const [disconnectingSlack, setDisconnectingSlack] = useState(false);

  const [discordWebhookUrl, setDiscordWebhookUrl] = useState<string>(org.discord_webhook_url ?? '');
  const [savingDiscord, setSavingDiscord] = useState(false);

  const [emailFromName, setEmailFromName] = useState<string>(org.email_from_name ?? '');
  const [emailFromAddress, setEmailFromAddress] = useState<string>(org.email_from_address ?? '');
  const [savingEmailFrom, setSavingEmailFrom] = useState(false);

  const [oidcIssuer, setOidcIssuer] = useState<string>(org.oidc_issuer ?? '');
  const [oidcClientId, setOidcClientId] = useState<string>(org.oidc_client_id ?? '');
  const [oidcClientSecret, setOidcClientSecret] = useState<string>('');
  const [ssoRequired, setSsoRequired] = useState<boolean>(org.sso_required ?? false);
  const [savingOidc, setSavingOidc] = useState(false);

  const [scimToken, setScimToken] = useState<string | null>(null);
  const [generatingScim, setGeneratingScim] = useState(false);
  const [scimEnabled] = useState<boolean>(!!(org as { scim_token?: string | null }).scim_token);

  const [customDomain, setCustomDomain] = useState<string>(org.custom_domain ?? '');
  const [customDomainVerified, setCustomDomainVerified] = useState<boolean>(org.custom_domain_verified ?? false);
  const [domainVerificationToken, setDomainVerificationToken] = useState<string | null>(null);
  const [savingCustomDomain, setSavingCustomDomain] = useState(false);
  const [verifyingDomain, setVerifyingDomain] = useState(false);

  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookEvents, setWebhookEvents] = useState<string[]>([]);
  const [addingWebhook, setAddingWebhook] = useState(false);
  const [deletingWebhookId, setDeletingWebhookId] = useState<string | null>(null);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [newApiKeyName, setNewApiKeyName] = useState('');
  const [creatingApiKey, setCreatingApiKey] = useState(false);
  const [newApiKeyValue, setNewApiKeyValue] = useState<string | null>(null);
  const [revokingApiKeyId, setRevokingApiKeyId] = useState<string | null>(null);

  const [retentionMonths, setRetentionMonths] = useState<string>(
    org.data_retention_months != null ? String(org.data_retention_months) : '',
  );
  const [savingRetention, setSavingRetention] = useState(false);
  const [quadraticCredits, setQuadraticCredits] = useState<string>(
    org.quadratic_credits != null ? String(org.quadratic_credits) : '',
  );
  const [creditPeriodDays, setCreditPeriodDays] = useState<string>(
    org.credit_period_days != null ? String(org.credit_period_days) : '',
  );
  const [savingCredits, setSavingCredits] = useState(false);
  const [allocatingCredits, setAllocatingCredits] = useState(false);

  const [importJson, setImportJson] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created: number; errors: Array<{ index: number; message: string }> } | null>(null);

  useEffect(() => {
    if ((org as { nonprofit_name?: string | null }).nonprofit_name) setNonprofitName((org as { nonprofit_name?: string | null }).nonprofit_name!);
    if ((org as { nonprofit_registration_number?: string | null }).nonprofit_registration_number) setNonprofitRegNumber((org as { nonprofit_registration_number?: string | null }).nonprofit_registration_number!);
    if ((org as { nonprofit_country?: string | null }).nonprofit_country) setNonprofitCountry((org as { nonprofit_country?: string | null }).nonprofit_country!);
  }, [org.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    orgsApi.listAuditLog(org.slug).then(({ items }) => setAuditLog(items)).catch(() => {}).finally(() => setAuditLogLoading(false));
    orgsApi.getAnalytics(org.slug).then(setAnalytics).catch(() => {}).finally(() => setAnalyticsLoading(false));
    billingApi.getStatus(org.id).then(setBillingStatus).catch(() => {});
    orgsApi.listInvites(org.slug).then(setPendingInvites).catch(() => {});
    webhooksApi.list(org.slug).then(setWebhooks).catch(() => {});
    apiKeysApi.list(org.slug).then(setApiKeys).catch(() => {});
    if (org.slack_team_id) {
      slackApi.listChannels(org.id).then(setSlackChannels).catch(() => {});
    }
    // Show toast if returning from Slack OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack') === 'connected') {
      addToast('Slack connected!', 'success');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [org.slug, org.id, org.slack_team_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) {
    return <p className={styles.denied}>Access denied — admins only.</p>;
  }

  async function saveOrgInfo(e: React.FormEvent) {
    e.preventDefault();
    setSavingInfo(true);
    setInfoError('');
    try {
      await orgsApi.update(org.slug, { name: name.trim(), description });
      addToast('Organisation updated', 'success');
    } catch (err) {
      setInfoError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingInfo(false);
    }
  }

  async function saveBranding(e: React.FormEvent) {
    e.preventDefault();
    setSavingBranding(true);
    try {
      const color = primaryColor.trim() || null;
      const logo = logoUrl.trim() || null;
      await orgsApi.update(org.slug, { primary_color: color, logo_url: logo });
      addToast('Branding saved', 'success');
    } catch {
      addToast('Failed to save branding', 'error');
    } finally {
      setSavingBranding(false);
    }
  }

  async function saveCreationRole(field: 'proposal_creation_role' | 'topic_creation_role', role: CreationRole) {
    if (field === 'proposal_creation_role') setProposalCreationRole(role);
    else setTopicCreationRole(role);
    setSavingRole(true);
    try {
      await orgsApi.update(org.slug, { [field]: role });
      addToast('Setting saved', 'success');
    } catch {
      addToast('Failed to save setting', 'error');
      if (field === 'proposal_creation_role') setProposalCreationRole(org.proposal_creation_role ?? 'member');
      else setTopicCreationRole(org.topic_creation_role ?? 'member');
    } finally {
      setSavingRole(false);
    }
  }

  async function saveIsPublic(value: boolean) {
    setIsPublic(value);
    setSavingPublic(true);
    try {
      await orgsApi.update(org.slug, { is_public: value });
      addToast('Setting saved', 'success');
    } catch {
      addToast('Failed to save setting', 'error');
      setIsPublic(org.is_public ?? false);
    } finally {
      setSavingPublic(false);
    }
  }

  async function saveMinEndorsements(e: React.FormEvent) {
    e.preventDefault();
    const value = parseInt(minEndorsements, 10);
    if (isNaN(value) || value < 0) return;
    setSavingEndorsements(true);
    try {
      await orgsApi.update(org.slug, { min_endorsements: value });
      addToast('Setting saved', 'success');
    } catch {
      addToast('Failed to save setting', 'error');
    } finally {
      setSavingEndorsements(false);
    }
  }

  async function saveVetoRole(value: 'moderator' | 'admin') {
    setVetoRole(value);
    setSavingVetoRole(true);
    try {
      await orgsApi.update(org.slug, { veto_role: value });
      addToast('Setting saved', 'success');
    } catch {
      addToast('Failed to save setting', 'error');
      setVetoRole((org as { veto_role?: 'moderator' | 'admin' }).veto_role ?? 'admin');
    } finally {
      setSavingVetoRole(false);
    }
  }

  async function saveVotingVisibility(value: 'public' | 'hidden') {
    setVotingVisibility(value);
    setSavingVisibility(true);
    try {
      await orgsApi.update(org.slug, { voting_visibility: value });
      addToast('Setting saved', 'success');
    } catch {
      addToast('Failed to save setting', 'error');
      setVotingVisibility(org.voting_visibility ?? 'public');
    } finally {
      setSavingVisibility(false);
    }
  }

  async function saveDefaults(e: React.FormEvent) {
    e.preventDefault();
    const threshold = parseInt(defaultThreshold, 10);
    if (isNaN(threshold) || threshold < 1 || threshold > 100) {
      setDefaultsError('Threshold must be between 1 and 100.');
      return;
    }
    const duration = defaultDuration === '' ? null : parseInt(defaultDuration, 10);
    if (duration !== null && (isNaN(duration) || duration < 1)) {
      setDefaultsError('Duration must be a positive number of days.');
      return;
    }
    const quorum = defaultQuorum === '' ? null : parseInt(defaultQuorum, 10);
    if (quorum !== null && (isNaN(quorum) || quorum < 1 || quorum > 100)) {
      setDefaultsError('Quorum must be between 1 and 100.');
      return;
    }
    setSavingDefaults(true);
    setDefaultsError('');
    try {
      await orgsApi.update(org.slug, { default_voting_duration_days: duration, default_threshold: threshold, default_quorum: quorum });
      addToast('Defaults saved', 'success');
    } catch (err) {
      setDefaultsError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSavingDefaults(false);
    }
  }

  async function saveRequireApproval(value: boolean) {
    setRequireApproval(value);
    setSavingApproval(true);
    try {
      await orgsApi.update(org.slug, { require_member_approval: value });
      addToast('Setting saved', 'success');
    } catch {
      addToast('Failed to save setting', 'error');
      setRequireApproval((org as { require_member_approval?: boolean }).require_member_approval ?? false);
    } finally {
      setSavingApproval(false);
    }
  }

  async function saveAllowedDomains() {
    const domains = allowedDomains
      .split(/[\s,]+/)
      .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean);
    setSavingDomains(true);
    try {
      await orgsApi.update(org.slug, { allowed_email_domains: domains });
      setAllowedDomains(domains.join(', '));
      addToast('Domain allowlist saved', 'success');
    } catch {
      addToast('Failed to save domain allowlist', 'error');
    } finally {
      setSavingDomains(false);
    }
  }

  async function saveWeightMode(value: 'manual' | 'by_role') {
    setWeightMode(value);
    setSavingWeightMode(true);
    try {
      await orgsApi.update(org.slug, { weight_mode: value });
      addToast('Weight mode saved', 'success');
    } catch {
      addToast('Failed to save weight mode', 'error');
      setWeightMode((org as { weight_mode?: 'manual' | 'by_role' }).weight_mode ?? 'manual');
    } finally {
      setSavingWeightMode(false);
    }
  }

  async function handleApproveMember(userId: string) {
    setApprovingId(userId);
    try {
      await orgsApi.approveMember(org.slug, userId);
      addToast('Member approved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to approve member', 'error');
    } finally {
      setApprovingId(null);
    }
  }

  async function handleRejectMember(userId: string) {
    setRejectingId(userId);
    try {
      await orgsApi.rejectMember(org.slug, userId);
      addToast('Member request rejected', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to reject member', 'error');
    } finally {
      setRejectingId(null);
    }
  }

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addToast('Please enter a valid email address.', 'error');
      return;
    }
    setSendingInvite(true);
    try {
      await orgsApi.sendInvite(org.slug, inviteEmail.trim());
      addToast(`Invite sent to ${inviteEmail.trim()}`, 'success');
      setInviteEmail('');
      const updated = await orgsApi.listInvites(org.slug);
      setPendingInvites(updated);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to send invite', 'error');
    } finally {
      setSendingInvite(false);
    }
  }

  async function handleCancelInvite(inviteId: string) {
    setCancellingInviteId(inviteId);
    try {
      await orgsApi.cancelInvite(org.slug, inviteId);
      setPendingInvites((prev) => prev.filter((i) => i.id !== inviteId));
      addToast('Invite cancelled', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to cancel invite', 'error');
    } finally {
      setCancellingInviteId(null);
    }
  }

  async function handleTransferOwnership() {
    if (!transferToId) return;
    setTransferring(true);
    try {
      await orgsApi.transferOwnership(org.slug, transferToId);
      addToast('Ownership transferred — you are now a member', 'info');
      navigate({ to: '/orgs/$slug/proposals', params: { slug: org.slug } });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to transfer ownership', 'error');
      setTransferring(false);
    }
  }

  async function addTemplate() {
    const tmplName = newTmplName.trim();
    if (!tmplName) return;
    setSavingTemplate(true);
    try {
      const updated = [...templates, {
        id: crypto.randomUUID(),
        name: tmplName,
        description: newTmplDescription.trim(),
        proposal_type: newTmplType,
        threshold: newTmplThreshold,
      }];
      await orgsApi.update(org.slug, { proposal_templates: updated });
      setTemplates(updated);
      setNewTmplName('');
      setNewTmplDescription('');
      setNewTmplType('standard');
      setNewTmplThreshold(50);
      addToast('Template added', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add template', 'error');
    } finally {
      setSavingTemplate(false);
    }
  }

  async function removeTemplate(id: string) {
    const updated = templates.filter((t) => t.id !== id);
    try {
      await orgsApi.update(org.slug, { proposal_templates: updated });
      setTemplates(updated);
      addToast('Template removed', 'info');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to remove template', 'error');
    }
  }

  async function deleteOrg() {
    setDeleting(true);
    try {
      await orgsApi.delete(org.slug);
      addToast('Organisation deleted', 'info');
      window.location.href = '/';
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete', 'error');
      setDeleting(false);
    }
  }

  async function handleUpgrade() {
    setUpgradingToStripe(true);
    try {
      const { url } = await billingApi.createCheckout(org.id, window.location.href);
      window.location.href = url;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start checkout', 'error');
      setUpgradingToStripe(false);
    }
  }

  async function handleManageBilling() {
    setManagingBilling(true);
    try {
      const { url } = await billingApi.createPortal(org.id, window.location.href);
      window.location.href = url;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to open billing portal', 'error');
      setManagingBilling(false);
    }
  }

  async function handleConnectSlack() {
    setConnectingSlack(true);
    try {
      const { url } = await slackApi.getConnectUrl(org.slug);
      window.location.href = url;
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start Slack connection', 'error');
      setConnectingSlack(false);
    }
  }

  async function handleDisconnectSlack() {
    setDisconnectingSlack(true);
    try {
      await slackApi.disconnect(org.id);
      addToast('Slack disconnected', 'info');
      setSlackChannels(null);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to disconnect Slack', 'error');
    } finally {
      setDisconnectingSlack(false);
    }
  }

  async function handleSaveSlackChannel() {
    if (!selectedSlackChannel) return;
    setSavingSlackChannel(true);
    try {
      await slackApi.setChannel(org.id, selectedSlackChannel);
      addToast('Slack channel saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to save channel', 'error');
    } finally {
      setSavingSlackChannel(false);
    }
  }

  async function handleAddWebhook(e: React.FormEvent) {
    e.preventDefault();
    const url = webhookUrl.trim();
    if (!url) return;
    setAddingWebhook(true);
    setNewWebhookSecret(null);
    try {
      const created = await webhooksApi.create(org.slug, url, webhookEvents);
      setWebhooks((prev) => [...prev, created]);
      setNewWebhookSecret(created.secret);
      setWebhookUrl('');
      setWebhookEvents([]);
      addToast('Webhook endpoint added', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to add webhook', 'error');
    } finally {
      setAddingWebhook(false);
    }
  }

  async function handleDeleteWebhook(id: string) {
    setDeletingWebhookId(id);
    try {
      await webhooksApi.delete(org.slug, id);
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      addToast('Webhook removed', 'success');
    } catch {
      addToast('Failed to remove webhook', 'error');
    } finally {
      setDeletingWebhookId(null);
    }
  }

  async function handleCreateApiKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newApiKeyName.trim()) return;
    setCreatingApiKey(true);
    setNewApiKeyValue(null);
    try {
      const result = await apiKeysApi.create(org.slug, newApiKeyName.trim());
      setApiKeys((prev) => [result.record, ...prev]);
      setNewApiKeyValue(result.key);
      setNewApiKeyName('');
      addToast('API key created', 'success');
    } catch {
      addToast('Failed to create API key', 'error');
    } finally {
      setCreatingApiKey(false);
    }
  }

  async function handleRevokeApiKey(keyId: string) {
    setRevokingApiKeyId(keyId);
    try {
      await apiKeysApi.revoke(org.slug, keyId);
      setApiKeys((prev) => prev.filter((k) => k.id !== keyId));
      addToast('API key revoked', 'success');
    } catch {
      addToast('Failed to revoke API key', 'error');
    } finally {
      setRevokingApiKeyId(null);
    }
  }

  const nonAdminMembers = orgMembers.filter(
    (m: Membership) => m.user_id !== currentUser?.id && m.role !== 'admin' && m.status !== 'pending',
  );
  const pendingMembers = orgMembers.filter((m: Membership) => m.status === 'pending');

  return (
    <div className={styles.page}>
      <h2 className={styles.heading}>Admin</h2>

      {/* Org info */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Organisation info</h3>
        <form className={styles.form} onSubmit={saveOrgInfo}>
          <div className={styles.formField}>
            <label htmlFor="admin-name" className={styles.formLabel}>Name</label>
            <input
              id="admin-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
              className={styles.formInput}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="admin-description" className={styles.formLabel}>Description</label>
            <textarea
              id="admin-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={styles.formTextarea}
            />
          </div>
          {infoError && <p className={styles.formError}>{infoError}</p>}
          <div>
            <Button type="submit" size="sm" disabled={savingInfo}>
              {savingInfo ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      </section>

      {/* Branding */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Branding</h3>
        <p className={styles.sectionHint}>Custom accent color and logo applied throughout the org's pages.</p>
        <form className={styles.form} onSubmit={saveBranding}>
          <div className={styles.formField}>
            <label htmlFor="admin-primary-color" className={styles.formLabel}>Primary color <span className={styles.formLabelNote}>(hex, e.g. #3358c4)</span></label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <input
                id="admin-primary-color"
                type="color"
                value={primaryColor || '#111111'}
                onChange={(e) => setPrimaryColor(e.target.value)}
                style={{ width: 40, height: 32, padding: 2, border: 'var(--border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
              />
              <input
                type="text"
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#3358c4"
                className={styles.formInput}
                style={{ width: 100 }}
              />
              {primaryColor && (
                <button type="button" onClick={() => setPrimaryColor('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>
                  Clear
                </button>
              )}
            </div>
          </div>
          <div className={styles.formField}>
            <label htmlFor="admin-logo-url" className={styles.formLabel}>Logo URL <span className={styles.formLabelNote}>(optional)</span></label>
            <input
              id="admin-logo-url"
              type="url"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://example.com/logo.png"
              className={styles.formInput}
            />
          </div>
          <div>
            <Button type="submit" size="sm" disabled={savingBranding}>
              {savingBranding ? 'Saving…' : 'Save branding'}
            </Button>
          </div>
        </form>
      </section>

      {/* Proposal defaults */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Proposal defaults</h3>
        <form className={styles.form} onSubmit={saveDefaults}>
          <div className={styles.formField}>
            <label htmlFor="admin-duration" className={styles.formLabel}>Default voting duration (days)</label>
            <p className={styles.formHint}>Leave blank for no deadline by default.</p>
            <input
              id="admin-duration"
              type="number"
              min={1}
              max={365}
              value={defaultDuration}
              onChange={(e) => setDefaultDuration(e.target.value)}
              placeholder="e.g. 7"
              className={styles.formInput}
              style={{ width: 120 }}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="admin-threshold" className={styles.formLabel}>Default passing threshold (%)</label>
            <input
              id="admin-threshold"
              type="number"
              min={1}
              max={100}
              value={defaultThreshold}
              onChange={(e) => setDefaultThreshold(e.target.value)}
              className={styles.formInput}
              style={{ width: 120 }}
            />
          </div>
          <div className={styles.formField}>
            <label htmlFor="admin-quorum" className={styles.formLabel}>Default quorum (% of members who must participate)</label>
            <p className={styles.formHint}>Leave blank for no quorum requirement by default.</p>
            <input
              id="admin-quorum"
              type="number"
              min={1}
              max={100}
              value={defaultQuorum}
              onChange={(e) => setDefaultQuorum(e.target.value)}
              placeholder="e.g. 50"
              className={styles.formInput}
              style={{ width: 120 }}
            />
          </div>
          {defaultsError && <p className={styles.formError}>{defaultsError}</p>}
          <div>
            <Button type="submit" size="sm" disabled={savingDefaults}>
              {savingDefaults ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        </form>
      </section>

      {/* Permissions */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Permissions</h3>
        <div className={styles.permissionsBlock}>
          <div>
            <p className={styles.permQuestion}>Who can create proposals?</p>
            <div className={styles.radioGroup}>
              {(['member', 'moderator', 'admin'] as CreationRole[]).map((role) => (
                <label key={role} className={styles.radioLabel} aria-disabled={savingRole ? 'true' : undefined}>
                  <input
                    type="radio"
                    name="proposal_creation_role"
                    value={role}
                    checked={proposalCreationRole === role}
                    onChange={() => saveCreationRole('proposal_creation_role', role)}
                    disabled={savingRole}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className={styles.permQuestion}>Who can create topics?</p>
            <div className={styles.radioGroup}>
              {(['member', 'moderator', 'admin'] as CreationRole[]).map((role) => (
                <label key={role} className={styles.radioLabel} aria-disabled={savingRole ? 'true' : undefined}>
                  <input
                    type="radio"
                    name="topic_creation_role"
                    value={role}
                    checked={topicCreationRole === role}
                    onChange={() => saveCreationRole('topic_creation_role', role)}
                    disabled={savingRole}
                  />
                  {ROLE_LABELS[role]}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className={styles.permQuestion}>Voting visibility during open proposals</p>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel} aria-disabled={savingVisibility ? 'true' : undefined}>
                <input
                  type="radio"
                  name="voting_visibility"
                  value="public"
                  checked={votingVisibility === 'public'}
                  onChange={() => saveVotingVisibility('public')}
                  disabled={savingVisibility}
                />
                Show live vote counts
              </label>
              <label className={styles.radioLabel} aria-disabled={savingVisibility ? 'true' : undefined}>
                <input
                  type="radio"
                  name="voting_visibility"
                  value="hidden"
                  checked={votingVisibility === 'hidden'}
                  onChange={() => saveVotingVisibility('hidden')}
                  disabled={savingVisibility}
                />
                Hide vote counts until proposal closes
              </label>
            </div>
          </div>
          <div>
            <p className={styles.permQuestion}>Endorsements required to publish a draft</p>
            <p className={styles.formHint}>
              Set to 0 to disable — authors can publish drafts immediately. Set to 1 or more to require that many other members endorse the proposal first.
            </p>
            <form onSubmit={saveMinEndorsements} className={styles.endorseRow}>
              <input
                type="number"
                min={0}
                max={20}
                value={minEndorsements}
                onChange={(e) => setMinEndorsements(e.target.value)}
                data-testid="min-endorsements-input"
                className={styles.formInput}
                style={{ width: 80 }}
              />
              <Button type="submit" size="sm" disabled={savingEndorsements}>
                {savingEndorsements ? 'Saving…' : 'Save'}
              </Button>
            </form>
          </div>
          <div>
            <p className={styles.permQuestion}>Boost threshold</p>
            <p className={styles.formHint}>
              Members can boost draft proposals to push them into the active queue. When total boosts reach this threshold the proposal automatically goes live. Leave blank to disable boosting.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const value = boostThreshold.trim() ? parseInt(boostThreshold, 10) : null;
                setSavingBoostThreshold(true);
                try {
                  await orgsApi.update(org.slug, { boost_threshold: value });
                  addToast('Boost threshold saved', 'success');
                } catch {
                  addToast('Failed to save boost threshold', 'error');
                } finally {
                  setSavingBoostThreshold(false);
                }
              }}
              className={styles.endorseRow}
            >
              <input
                type="number"
                min={1}
                value={boostThreshold}
                onChange={(e) => setBoostThreshold(e.target.value)}
                placeholder="e.g. 5"
                className={styles.formInput}
                style={{ width: 80 }}
              />
              <Button type="submit" size="sm" disabled={savingBoostThreshold}>
                {savingBoostThreshold ? 'Saving…' : 'Save'}
              </Button>
              {boostThreshold && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={savingBoostThreshold}
                  onClick={async () => {
                    setSavingBoostThreshold(true);
                    try {
                      await orgsApi.update(org.slug, { boost_threshold: null });
                      setBoostThreshold('');
                      addToast('Boost threshold removed', 'info');
                    } catch {
                      addToast('Failed to remove boost threshold', 'error');
                    } finally {
                      setSavingBoostThreshold(false);
                    }
                  }}
                >
                  Disable
                </Button>
              )}
            </form>
          </div>
          <div>
            <p className={styles.permQuestion}>Who can cast a veto?</p>
            <p className={styles.formHint}>A veto blocks a proposal from passing regardless of vote counts.</p>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel} aria-disabled={savingVetoRole ? 'true' : undefined}>
                <input
                  type="radio"
                  name="veto_role"
                  value="moderator"
                  checked={vetoRole === 'moderator'}
                  onChange={() => saveVetoRole('moderator')}
                  disabled={savingVetoRole}
                />
                Moderator and above
              </label>
              <label className={styles.radioLabel} aria-disabled={savingVetoRole ? 'true' : undefined}>
                <input
                  type="radio"
                  name="veto_role"
                  value="admin"
                  checked={vetoRole === 'admin'}
                  onChange={() => saveVetoRole('admin')}
                  disabled={savingVetoRole}
                  data-testid="veto-role-admin"
                />
                Admin only
              </label>
            </div>
          </div>
          <div>
            <p className={styles.permQuestion}>Public organisation</p>
            <p className={styles.formHint}>
              Public organisations are listed on the discovery page and anyone can join without an invitation.
            </p>
            <label id="admin-is-public-label" className={styles.checkLabel} aria-disabled={savingPublic ? 'true' : undefined}>
              <input
                id="admin-is-public"
                type="checkbox"
                checked={isPublic}
                onChange={(e) => saveIsPublic(e.target.checked)}
                disabled={savingPublic}
              />
              Allow anyone to discover and join this organisation
            </label>
          </div>
          <div>
            <p className={styles.permQuestion}>Require approval for new members</p>
            <p className={styles.formHint}>
              When enabled, users who join publicly will be placed in a pending queue until an admin approves them.
            </p>
            <label className={styles.checkLabel} aria-disabled={savingApproval ? 'true' : undefined}>
              <input
                id="admin-require-approval"
                type="checkbox"
                checked={requireApproval}
                onChange={(e) => saveRequireApproval(e.target.checked)}
                disabled={savingApproval}
              />
              Require admin approval before new members can participate
            </label>
          </div>
          <div>
            <p className={styles.permQuestion}>Email domain allowlist</p>
            <p className={styles.formHint}>
              Restrict membership to specific email domains. Enter domains separated by commas (e.g. <code>acme.com, acme.org</code>). Leave empty to allow any email.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="text"
                value={allowedDomains}
                onChange={(e) => setAllowedDomains(e.target.value)}
                placeholder="acme.com, acme.org"
                style={{ flex: 1, minWidth: 200, padding: '0.4rem 0.75rem', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: 13 }}
              />
              <Button size="sm" onClick={saveAllowedDomains} disabled={savingDomains}>
                {savingDomains ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
          <div>
            <p className={styles.permQuestion}>Vote weight mode</p>
            <p className={styles.formHint}>
              Manual: admins assign a numeric weight to each member. By role: admin=3, moderator=2, member=1, observer=0.
            </p>
            <div className={styles.radioGroup}>
              {(['manual', 'by_role'] as const).map((mode) => (
                <label key={mode} className={styles.radioLabel} aria-disabled={savingWeightMode ? 'true' : undefined}>
                  <input
                    type="radio"
                    name="weight_mode"
                    value={mode}
                    checked={weightMode === mode}
                    onChange={() => saveWeightMode(mode)}
                    disabled={savingWeightMode}
                  />
                  {mode === 'manual' ? 'Manual (per-member weight)' : 'By role (admin=3, moderator=2, member=1, observer=0)'}
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Pending approvals */}
      {pendingMembers.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Pending approval ({pendingMembers.length})</h3>
          <p className={styles.sectionHint}>These users have requested to join and are waiting for approval.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {pendingMembers.map((m: Membership) => {
              const user = usersById.get(m.user_id);
              return (
                <div key={m.user_id} data-testid="pending-member-row" className={styles.pendingRow}>
                  <span className={styles.pendingName}>{user?.name ?? m.user_id}</span>
                  <div className={styles.pendingActions}>
                    <Button
                      size="sm"
                      onClick={() => handleApproveMember(m.user_id)}
                      disabled={approvingId === m.user_id || rejectingId === m.user_id}
                      data-testid="approve-member-btn"
                    >
                      {approvingId === m.user_id ? 'Approving…' : 'Approve'}
                    </Button>
                    <ConfirmButton
                      label="Reject"
                      confirmLabel="Yes, reject"
                      onConfirm={() => handleRejectMember(m.user_id)}
                      disabled={approvingId === m.user_id || rejectingId === m.user_id}
                      style={{ fontSize: 'var(--text-xs)', padding: '0 var(--space-2)', height: '26px', color: 'var(--color-error)', border: '1px solid var(--color-error-border)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                      confirmStyle={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)' }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Invite by email */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Invite members</h3>
        <p className={styles.sectionHint}>Send a personal invite link via email. The recipient gets 7 days to accept.</p>
        <form onSubmit={handleSendInvite} style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@example.com"
            required
            className={styles.formInput}
            style={{ flex: 1 }}
            data-testid="invite-email-input"
          />
          <Button type="submit" size="sm" disabled={sendingInvite || !inviteEmail.trim()}>
            {sendingInvite ? 'Sending…' : 'Send invite'}
          </Button>
        </form>
        {pendingInvites.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <p className={styles.sectionHint} style={{ margin: 0 }}>Pending invites</p>
            {pendingInvites.map((invite) => (
              <div key={invite.id} className={styles.pendingRow} data-testid="pending-invite-row">
                <div>
                  <span className={styles.pendingName}>{invite.email}</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)', marginLeft: 'var(--space-3)' }}>
                    sent by {invite.invited_by_name ?? 'admin'} · expires {formatDate(invite.expires_at)}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={cancellingInviteId === invite.id}
                  onClick={() => handleCancelInvite(invite.id)}
                  data-testid="cancel-invite-btn"
                >
                  {cancellingInviteId === invite.id ? 'Cancelling…' : 'Cancel'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Transfer ownership */}
      {nonAdminMembers.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Transfer ownership</h3>
          <p className={styles.sectionHint}>Promote another member to admin and step down to member yourself.</p>
          <div className={styles.transferRow}>
            <select
              value={transferToId}
              onChange={(e) => setTransferToId(e.target.value)}
              className={styles.formSelect}
              style={{ width: 'auto' }}
            >
              <option value="">Select a member…</option>
              {nonAdminMembers.map((m: Membership) => {
                const user = usersById.get(m.user_id);
                return (
                  <option key={m.user_id} value={m.user_id}>
                    {user?.name ?? m.user_id} ({m.role})
                  </option>
                );
              })}
            </select>
            <ConfirmButton
              label="Transfer ownership"
              confirmLabel="Yes, transfer"
              onConfirm={handleTransferOwnership}
              disabled={!transferToId || transferring}
              style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)', height: '32px', border: 'var(--border)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--color-fg)' }}
              confirmStyle={{ border: 'var(--border)', background: 'none', borderRadius: 'var(--radius-sm)', color: 'var(--color-fg)' }}
            />
          </div>
        </section>
      )}

      {/* Templates */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Proposal templates</h3>
        <p className={styles.sectionHint}>
          Templates pre-fill the new proposal form. Members see a "Use template" button when templates exist.
        </p>
        {templates.length > 0 && (
          <div className={styles.templateList}>
            {templates.map((t) => (
              <div key={t.id} data-testid="template-row" className={styles.templateRow}>
                <div>
                  <span className={styles.templateName}>{t.name}</span>
                  <span className={styles.templateMeta}>
                    {t.proposal_type === 'standard' ? 'Vote' : t.proposal_type === 'discussion' ? 'Discussion' : 'Multiple choice'} · {t.threshold}% threshold
                  </span>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => removeTemplate(t.id)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.templateFormWrap}>
          <input
            type="text"
            placeholder="Template name"
            value={newTmplName}
            onChange={(e) => setNewTmplName(e.target.value)}
            data-testid="template-name-input"
            className={styles.formInput}
          />
          <input
            type="text"
            placeholder="Description (optional)"
            value={newTmplDescription}
            onChange={(e) => setNewTmplDescription(e.target.value)}
            className={styles.formInput}
          />
          <div className={styles.templateTypeRow}>
            <select
              value={newTmplType}
              onChange={(e) => setNewTmplType(e.target.value as 'standard' | 'discussion' | 'multiple_choice')}
              className={styles.formSelect}
            >
              <option value="standard">Vote</option>
              <option value="discussion">Discussion</option>
              <option value="multiple_choice">Multiple choice</option>
            </select>
            <div className={styles.templateThresholdRow}>
              <label className={styles.formLabel}>Threshold</label>
              <input
                type="number"
                min={1}
                max={100}
                value={newTmplThreshold}
                onChange={(e) => setNewTmplThreshold(Number(e.target.value))}
                className={styles.formInput}
                style={{ width: 60 }}
              />
              <span className={styles.formLabel}>%</span>
            </div>
          </div>
          <Button
            size="sm"
            onClick={addTemplate}
            disabled={savingTemplate || !newTmplName.trim()}
            data-testid="add-template-btn"
            style={{ alignSelf: 'flex-start' }}
          >
            {savingTemplate ? 'Adding…' : '+ Add template'}
          </Button>
        </div>
      </section>

      {/* Analytics */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Participation analytics</h3>
        {analyticsLoading ? (
          <p className={styles.sectionHint}>Loading…</p>
        ) : !analytics ? (
          <p className={styles.sectionHint}>Could not load analytics.</p>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
              {[
                { label: 'Total proposals', value: analytics.totalProposals },
                { label: 'Open proposals', value: analytics.openProposals },
                { label: 'Closed proposals', value: analytics.closedProposals },
                { label: 'Total votes', value: analytics.totalVotes },
                { label: 'Members', value: analytics.totalMembers },
                { label: 'Participation rate', value: `${analytics.participationRate}%` },
                { label: 'Avg votes/proposal', value: analytics.avgVotesPerProposal },
              ].map(({ label, value }) => (
                <div key={label} style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '0.75rem 1rem', textAlign: 'center' }}>
                  <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-fg-muted)', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: 13, fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-fg-muted)' }}>Proposals per month (last 12 months)</p>
            {(() => {
              const max = Math.max(...analytics.proposalsByMonth.map((m) => m.count), 1);
              return (
                <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 80, marginBottom: '1.5rem' }}>
                  {analytics.proposalsByMonth.map(({ month, count }) => (
                    <div key={month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div
                        title={`${count} proposal${count !== 1 ? 's' : ''}`}
                        style={{ width: '100%', height: `${Math.max((count / max) * 64, count > 0 ? 4 : 0)}px`, background: 'var(--color-fg)', borderRadius: 2, transition: 'height 0.2s' }}
                      />
                      <span style={{ fontSize: 9, color: 'var(--color-fg-muted)', whiteSpace: 'nowrap' }}>{month}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-fg-muted)' }}>Top voters</p>
                {analytics.topVoters.length === 0 ? (
                  <p className={styles.sectionHint}>No votes recorded yet.</p>
                ) : (
                  <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {analytics.topVoters.map((v, i) => (
                      <li key={v.user_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                        <span style={{ color: 'var(--color-fg-muted)', marginRight: 8, minWidth: 16 }}>{i + 1}.</span>
                        <span style={{ flex: 1 }}>{v.name}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{v.voteCount}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-fg-muted)' }}>Proposal outcomes</p>
                {[
                  { label: 'Passed', value: analytics.proposalOutcomes.passed },
                  { label: 'Failed', value: analytics.proposalOutcomes.failed },
                  { label: 'Withdrawn', value: analytics.proposalOutcomes.withdrawn },
                ].map(({ label, value }) => (
                  <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
                    <span>{label}</span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {analytics.topicStats && analytics.topicStats.length > 0 && (
              <div style={{ marginTop: 'var(--space-4)' }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: '0.5rem', color: 'var(--color-fg-muted)' }}>Topic stats</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto repeat(3, auto)', gap: '4px 12px', fontSize: 13, alignItems: 'center' }}>
                  <span style={{ color: 'var(--color-fg-muted)', fontWeight: 600 }}>Topic</span>
                  <span style={{ color: 'var(--color-fg-muted)', fontWeight: 600, textAlign: 'right' }}>Proposals</span>
                  <span style={{ color: 'var(--color-fg-muted)', fontWeight: 600, textAlign: 'right' }}>Participation</span>
                  <span style={{ color: 'var(--color-fg-muted)', fontWeight: 600, textAlign: 'right' }}>Pass rate</span>
                  {analytics.topicStats.map((t) => (
                    <>
                      <span key={`${t.topic_id}-name`}>{t.topic_name}</span>
                      <span key={`${t.topic_id}-count`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.proposalCount}</span>
                      <span key={`${t.topic_id}-part`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.avgParticipation}%</span>
                      <span key={`${t.topic_id}-pass`} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.passRate}%</span>
                    </>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Audit log */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Recent activity</h3>
        {auditLogLoading ? (
          <p className={styles.sectionHint}>Loading…</p>
        ) : auditLog.length === 0 ? (
          <p className={styles.sectionHint}>No activity recorded yet.</p>
        ) : (
          <ul className={styles.auditList}>
            {auditLog.map((entry) => {
              const actor = entry.actor_id ? usersById.get(entry.actor_id) : null;
              const actorName = actor?.name ?? entry.actor_id ?? 'System';
              const date = formatDatetime(entry.created_at);
              return (
                <li key={entry.id} className={styles.auditEntry}>
                  <span className={styles.auditActor}>{actorName}</span>
                  {' · '}
                  <span data-testid="audit-action">{entry.action}</span>
                  {Object.keys(entry.metadata ?? {}).length > 0 && (
                    <span className={styles.auditMeta}> · {JSON.stringify(entry.metadata)}</span>
                  )}
                  <span className={styles.auditDate}>{date}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Slack integration */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Slack integration</h3>
        <p className={styles.sectionHint}>Post new proposals and results to a Slack channel automatically.</p>
        {org.slack_team_id ? (
          <div>
            <p style={{ fontSize: 13, marginBottom: '0.75rem' }}>
              Connected to <strong>{org.slack_team_name}</strong>
              {org.slack_channel_name && <> · posting to <strong>#{org.slack_channel_name}</strong></>}
            </p>
            {slackChannels !== null && (
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <select
                  value={selectedSlackChannel || org.slack_channel_id || ''}
                  onChange={(e) => setSelectedSlackChannel(e.target.value)}
                  className={styles.formSelect}
                  style={{ width: 'auto', minWidth: 180 }}
                >
                  <option value="">Select a channel…</option>
                  {slackChannels.map((c) => (
                    <option key={c.id} value={c.id}>#{c.name}</option>
                  ))}
                </select>
                <Button size="sm" onClick={handleSaveSlackChannel} disabled={savingSlackChannel || !selectedSlackChannel}>
                  {savingSlackChannel ? 'Saving…' : 'Save channel'}
                </Button>
              </div>
            )}
            <Button size="sm" variant="danger" onClick={handleDisconnectSlack} disabled={disconnectingSlack}>
              {disconnectingSlack ? 'Disconnecting…' : 'Disconnect Slack'}
            </Button>
          </div>
        ) : (
          <Button size="sm" onClick={handleConnectSlack} disabled={connectingSlack}>
            {connectingSlack ? 'Redirecting…' : 'Connect to Slack'}
          </Button>
        )}
      </section>

      {/* Discord integration */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Discord integration</h3>
        <p className={styles.sectionHint}>Post new proposals and results to a Discord channel. Paste a Discord webhook URL below.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingDiscord(true);
            try {
              await orgsApi.update(org.slug, { discord_webhook_url: discordWebhookUrl.trim() || null });
              addToast('Discord webhook saved', 'success');
            } catch {
              addToast('Failed to save Discord webhook', 'error');
            } finally {
              setSavingDiscord(false);
            }
          }}
          style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <input
            type="url"
            value={discordWebhookUrl}
            onChange={(e) => setDiscordWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/…"
            style={{ flex: 1, minWidth: 280, padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
          />
          <Button type="submit" size="sm" disabled={savingDiscord}>{savingDiscord ? 'Saving…' : 'Save'}</Button>
          {discordWebhookUrl && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingDiscord}
              onClick={async () => {
                setSavingDiscord(true);
                try {
                  await orgsApi.update(org.slug, { discord_webhook_url: null });
                  setDiscordWebhookUrl('');
                  addToast('Discord webhook removed', 'success');
                } catch {
                  addToast('Failed to remove Discord webhook', 'error');
                } finally {
                  setSavingDiscord(false);
                }
              }}
            >
              Remove
            </Button>
          )}
        </form>
      </section>

      {/* Email white-labelling */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Email sender</h3>
        <p className={styles.sectionHint}>Customise the "From" name and address used for notification emails sent from this organisation. Leave blank to use the Ripple defaults.</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingEmailFrom(true);
            try {
              await orgsApi.update(org.slug, {
                email_from_name: emailFromName.trim() || null,
                email_from_address: emailFromAddress.trim() || null,
              });
              addToast('Email sender settings saved', 'success');
            } catch {
              addToast('Failed to save email sender settings', 'error');
            } finally {
              setSavingEmailFrom(false);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 400 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Sender name</label>
            <input
              type="text"
              value={emailFromName}
              onChange={(e) => setEmailFromName(e.target.value)}
              placeholder="Acme Governance"
              style={{ padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Sender address</label>
            <input
              type="email"
              value={emailFromAddress}
              onChange={(e) => setEmailFromAddress(e.target.value)}
              placeholder="governance@example.com"
              style={{ padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
            />
          </div>
          <div>
            <Button type="submit" size="sm" disabled={savingEmailFrom}>{savingEmailFrom ? 'Saving…' : 'Save'}</Button>
          </div>
        </form>
      </section>

      {/* SSO / OIDC */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Single Sign-On (OIDC)</h3>
        <p className={styles.sectionHint}>
          Connect an OpenID Connect Identity Provider (Google Workspace, Okta, Azure AD) so members can sign in with their corporate credentials.
          Members are automatically provisioned to this organisation on first sign-in.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingOidc(true);
            try {
              await orgsApi.update(org.slug, {
                oidc_issuer: oidcIssuer.trim() || null,
                oidc_client_id: oidcClientId.trim() || null,
                oidc_client_secret: oidcClientSecret.trim() || null,
                sso_required: ssoRequired,
              } as Parameters<typeof orgsApi.update>[1]);
              addToast('SSO settings saved', 'success');
              setOidcClientSecret('');
            } catch {
              addToast('Failed to save SSO settings', 'error');
            } finally {
              setSavingOidc(false);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 480 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Issuer URL</label>
            <input
              type="url"
              value={oidcIssuer}
              onChange={(e) => setOidcIssuer(e.target.value)}
              placeholder="https://accounts.google.com"
              style={{ padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Client ID</label>
            <input
              type="text"
              value={oidcClientId}
              onChange={(e) => setOidcClientId(e.target.value)}
              placeholder="your-client-id"
              style={{ padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Client secret</label>
            <input
              type="password"
              value={oidcClientSecret}
              onChange={(e) => setOidcClientSecret(e.target.value)}
              placeholder={org.oidc_client_id ? '(leave blank to keep existing)' : 'your-client-secret'}
              style={{ padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={ssoRequired}
              onChange={(e) => setSsoRequired(e.target.checked)}
            />
            Require SSO — members must sign in via this provider (disables passkey/magic-link for org members)
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Button type="submit" size="sm" disabled={savingOidc}>{savingOidc ? 'Saving…' : 'Save'}</Button>
            {org.oidc_issuer && (
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)' }}>
                SSO login: <code style={{ background: 'var(--color-bg-subtle)', padding: '1px 4px', borderRadius: 3 }}>/api/auth/sso/{org.slug}</code>
              </span>
            )}
          </div>
        </form>
        {org.oidc_client_id && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={savingOidc}
            style={{ marginTop: 'var(--space-2)' }}
            onClick={async () => {
              setSavingOidc(true);
              try {
                await orgsApi.update(org.slug, {
                  oidc_issuer: null, oidc_client_id: null, oidc_client_secret: null, sso_required: false,
                } as Parameters<typeof orgsApi.update>[1]);
                setOidcIssuer('');
                setOidcClientId('');
                setOidcClientSecret('');
                setSsoRequired(false);
                addToast('SSO configuration removed', 'info');
              } catch {
                addToast('Failed to remove SSO configuration', 'error');
              } finally {
                setSavingOidc(false);
              }
            }}
          >
            Remove SSO configuration
          </Button>
        )}
      </section>

      {/* SCIM provisioning */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>SCIM provisioning</h3>
        <p className={styles.sectionHint}>
          Allow your Identity Provider (Okta, Azure AD, Google Workspace) to automatically sync membership. When a user is offboarded from your IdP, they'll be removed from this organisation.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 480 }}>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>
            <strong>SCIM base URL:</strong>{' '}
            <code style={{ background: 'var(--color-bg-subtle)', padding: '2px 6px', borderRadius: 3, fontSize: 'var(--text-xs)' }}>
              {window.location.origin}/api/scim/v2
            </code>
          </div>
          {scimToken ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <p style={{ fontSize: 'var(--text-sm)', fontWeight: 500, margin: 0 }}>SCIM Bearer token (copy now — it won't be shown again):</p>
              <code style={{ display: 'block', background: 'var(--color-bg-subtle)', padding: 'var(--space-2) var(--space-3)', borderRadius: 4, fontSize: 'var(--text-xs)', wordBreak: 'break-all', border: 'var(--border)' }}>
                {scimToken}
              </code>
              <Button size="sm" variant="ghost" onClick={() => setScimToken(null)}>Dismiss</Button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                disabled={generatingScim}
                onClick={async () => {
                  setGeneratingScim(true);
                  try {
                    const result = await orgsApi.generateScimToken(org.slug);
                    setScimToken(result.token);
                    addToast('SCIM token generated', 'success');
                  } catch {
                    addToast('Failed to generate SCIM token', 'error');
                  } finally {
                    setGeneratingScim(false);
                  }
                }}
              >
                {generatingScim ? 'Generating…' : scimEnabled ? 'Rotate SCIM token' : 'Generate SCIM token'}
              </Button>
              {scimEnabled && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={generatingScim}
                  onClick={async () => {
                    setGeneratingScim(true);
                    try {
                      await orgsApi.revokeScimToken(org.slug);
                      addToast('SCIM token revoked', 'info');
                    } catch {
                      addToast('Failed to revoke SCIM token', 'error');
                    } finally {
                      setGeneratingScim(false);
                    }
                  }}
                >
                  Revoke SCIM token
                </Button>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Custom domain */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Custom domain</h3>
        <p className={styles.sectionHint}>
          Map your own domain (e.g. <code>vote.acme.com</code>) to this organisation. TLS is provisioned automatically via Let's Encrypt.
          Point a DNS A record at this server and add a TXT record for verification.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingCustomDomain(true);
            try {
              const result = await orgsApi.setCustomDomain(org.slug, customDomain.trim() || null);
              if (result.verification_token) setDomainVerificationToken(result.verification_token);
              setCustomDomainVerified(false);
              addToast('Custom domain saved', 'success');
            } catch (err) {
              addToast(err instanceof Error ? err.message : 'Failed to save custom domain', 'error');
            } finally {
              setSavingCustomDomain(false);
            }
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 480 }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <input
              type="text"
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="vote.example.com"
              style={{ flex: 1, padding: '0 var(--space-3)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
            />
            <Button type="submit" size="sm" disabled={savingCustomDomain}>
              {savingCustomDomain ? 'Saving…' : 'Save'}
            </Button>
            {customDomain && org.custom_domain && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={savingCustomDomain}
                onClick={async () => {
                  setSavingCustomDomain(true);
                  try {
                    await orgsApi.setCustomDomain(org.slug, null);
                    setCustomDomain('');
                    setCustomDomainVerified(false);
                    setDomainVerificationToken(null);
                    addToast('Custom domain removed', 'info');
                  } catch {
                    addToast('Failed to remove custom domain', 'error');
                  } finally {
                    setSavingCustomDomain(false);
                  }
                }}
              >
                Remove
              </Button>
            )}
          </div>
          {domainVerificationToken && (
            <div style={{ background: 'var(--color-bg-subtle)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
              <p style={{ margin: '0 0 var(--space-1)', fontWeight: 500 }}>DNS verification required</p>
              <p style={{ margin: '0 0 var(--space-2)', color: 'var(--color-fg-muted)' }}>
                Add a TXT record to <strong>{customDomain}</strong>:
              </p>
              <code style={{ display: 'block', background: 'var(--color-bg)', border: 'var(--border)', borderRadius: 3, padding: '4px 8px', fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>
                {domainVerificationToken}
              </code>
            </div>
          )}
          {org.custom_domain && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              {customDomainVerified ? (
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)' }}>✓ Verified</span>
              ) : (
                <>
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>Not verified</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={verifyingDomain}
                    onClick={async () => {
                      setVerifyingDomain(true);
                      try {
                        const result = await orgsApi.verifyCustomDomain(org.slug);
                        if (result.verified) {
                          setCustomDomainVerified(true);
                          setDomainVerificationToken(null);
                          addToast('Domain verified!', 'success');
                        } else {
                          addToast(result.message, 'error');
                        }
                      } catch {
                        addToast('Verification check failed', 'error');
                      } finally {
                        setVerifyingDomain(false);
                      }
                    }}
                  >
                    {verifyingDomain ? 'Checking…' : 'Verify now'}
                  </Button>
                </>
              )}
            </div>
          )}
        </form>
      </section>

      {/* Billing */}
      {billingStatus && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Plan &amp; billing</h3>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <span style={{ fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{billingStatus.plan}</span>
              {billingStatus.plan === 'free' && billingStatus.memberLimit !== null && (
                <span style={{ fontSize: 13, color: 'var(--color-fg-muted)', marginLeft: 8 }}>
                  {billingStatus.memberCount} / {billingStatus.memberLimit} members
                </span>
              )}
              {billingStatus.plan === 'pro' && (
                <span style={{ fontSize: 13, color: 'var(--color-fg-muted)', marginLeft: 8 }}>
                  Unlimited members · $29/mo
                </span>
              )}
              {billingStatus.plan === 'nonprofit' && (
                <span style={{ fontSize: 13, color: '#2d9a4e', marginLeft: 8 }}>
                  Nonprofit — unlimited members, free
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {billingStatus.plan === 'free' && billingStatus.canUpgrade && (
                <Button size="sm" onClick={handleUpgrade} disabled={upgradingToStripe}>
                  {upgradingToStripe ? 'Redirecting…' : 'Upgrade to Pro'}
                </Button>
              )}
              {(billingStatus.plan === 'pro') && (
                <Button size="sm" variant="secondary" onClick={handleManageBilling} disabled={managingBilling}>
                  {managingBilling ? 'Redirecting…' : 'Manage billing'}
                </Button>
              )}
              <a href="/pricing" style={{ fontSize: 13, color: 'var(--color-fg-muted)', textDecoration: 'underline', display: 'flex', alignItems: 'center' }}>
                View pricing
              </a>
            </div>
          </div>
          {billingStatus.plan === 'free' && billingStatus.memberLimit !== null && billingStatus.memberCount >= billingStatus.memberLimit && (
            <div style={{ marginTop: '0.75rem', padding: '0.75rem 1rem', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 13 }}>
              You've reached the 15-member limit on the Free plan. Upgrade to Pro to add more members.
            </div>
          )}
        </section>
      )}

      {/* Webhooks */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Webhooks</h3>
        <p className={styles.sectionHint}>Receive HTTP POST notifications when events occur in this organisation. Sign with the secret shown once on creation.</p>

        {webhooks.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {webhooks.map((w) => (
              <div key={w.id} style={{ border: 'var(--border)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3) var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--text-sm)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.url}</p>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-fg-muted)' }}>
                    {w.events.length === 0 ? 'All events' : w.events.join(', ')}
                  </p>
                </div>
                <Button size="sm" variant="danger" onClick={() => handleDeleteWebhook(w.id)} disabled={deletingWebhookId === w.id}>
                  {deletingWebhookId === w.id ? 'Removing…' : 'Remove'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {newWebhookSecret && (
          <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)' }}>
            <strong>Secret (copy now — shown once):</strong>{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>{newWebhookSecret}</code>
          </div>
        )}

        <form onSubmit={handleAddWebhook} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className={styles.formField}>
            <label htmlFor="webhook-url" className={styles.formLabel}>Endpoint URL</label>
            <input
              id="webhook-url"
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              className={styles.formInput}
            />
          </div>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Events (leave empty for all)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {['proposal.opened', 'proposal.closed', 'vote.cast', 'member.joined'].map((ev) => (
                <label key={ev} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={webhookEvents.includes(ev)}
                    onChange={(e) => setWebhookEvents((prev) => e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev))}
                  />
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{ev}</code>
                </label>
              ))}
            </div>
          </div>
          <div>
            <Button type="submit" size="sm" disabled={addingWebhook || !webhookUrl.trim()}>
              {addingWebhook ? 'Adding…' : 'Add endpoint'}
            </Button>
          </div>
        </form>
      </section>

      {/* API Keys */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>API keys</h3>
        <p className={styles.sectionHint}>
          Long-lived keys for server-to-server access. Include as <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>Authorization: Bearer &lt;key&gt;</code> on requests.
        </p>

        {apiKeys.length > 0 && (
          <div style={{ marginBottom: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {apiKeys.map((k) => (
              <div key={k.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 'var(--weight-medium)', color: 'var(--color-fg)' }}>{k.name}</div>
                  <div style={{ color: 'var(--color-fg-muted)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>{k.key_preview}</div>
                  {k.last_used_at && (
                    <div style={{ color: 'var(--color-fg-subtle)', fontSize: 'var(--text-xs)' }}>
                      Last used {formatDate(k.last_used_at)}
                    </div>
                  )}
                </div>
                <Button size="sm" variant="danger" onClick={() => handleRevokeApiKey(k.id)} disabled={revokingApiKeyId === k.id}>
                  {revokingApiKeyId === k.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {newApiKeyValue && (
          <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)' }}>
            <strong>API key (copy now — shown once):</strong>{' '}
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', wordBreak: 'break-all' }}>{newApiKeyValue}</code>
          </div>
        )}

        <form onSubmit={handleCreateApiKey} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
          <div className={styles.formField} style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="api-key-name" className={styles.formLabel}>Key name</label>
            <input
              id="api-key-name"
              type="text"
              value={newApiKeyName}
              onChange={(e) => setNewApiKeyName(e.target.value)}
              placeholder="e.g. CI/CD integration"
              className={styles.formInput}
            />
          </div>
          <Button type="submit" size="sm" disabled={creatingApiKey || !newApiKeyName.trim()}>
            {creatingApiKey ? 'Creating…' : 'Create key'}
          </Button>
        </form>
      </section>

      {/* Data retention */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Data retention</h3>
        <p className={styles.sectionHint}>
          Automatically delete closed proposals after a set number of months. Leave blank to keep proposals indefinitely.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingRetention(true);
            try {
              const months = retentionMonths.trim() ? parseInt(retentionMonths, 10) : null;
              await orgsApi.update(org.slug, { data_retention_months: months });
              addToast('Retention policy saved', 'success');
            } catch {
              addToast('Failed to save retention policy', 'error');
            } finally {
              setSavingRetention(false);
            }
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
        >
          <input
            type="number"
            min={1}
            max={120}
            value={retentionMonths}
            onChange={(e) => setRetentionMonths(e.target.value)}
            placeholder="e.g. 12"
            style={{ width: 80, padding: '0 var(--space-2)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
          />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>months</span>
          <Button type="submit" size="sm" disabled={savingRetention}>{savingRetention ? 'Saving…' : 'Save'}</Button>
        </form>
      </section>

      {/* Protected topics */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Protected topics</h3>
        <p className={styles.sectionHint}>
          Mark topics as constitutional to require a supermajority (≥66%) and automatic 7-day deliberation period for all proposals in those topics.
        </p>
        {orgTopics.length === 0 ? (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>No topics yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {orgTopics.map((topic: Topic) => (
              <label key={topic.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', cursor: 'pointer', fontSize: 'var(--text-sm)' }}>
                <input
                  type="checkbox"
                  checked={!!topic.is_constitutional}
                  disabled={togglingConstitutional === topic.id}
                  onChange={async (e) => {
                    setTogglingConstitutional(topic.id);
                    try {
                      await topicsApi.update(topic.id, { is_constitutional: e.target.checked });
                      addToast(e.target.checked ? `"${topic.name}" is now constitutional` : `"${topic.name}" is no longer constitutional`, 'success');
                    } catch {
                      addToast('Failed to update topic', 'error');
                    } finally {
                      setTogglingConstitutional(null);
                    }
                  }}
                />
                <span>{topic.name}</span>
                {topic.is_constitutional && (
                  <span style={{ fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-muted)', border: 'var(--border)', color: 'var(--color-fg-muted)' }}>Constitutional</span>
                )}
              </label>
            ))}
          </div>
        )}
      </section>

      {/* Quadratic voting credits */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Quadratic voting credits</h3>
        <p className={styles.sectionHint}>
          Set the number of credits each member receives per allocation period. Click "Allocate now" to reset all member balances to this amount.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setSavingCredits(true);
            try {
              const credits = quadraticCredits.trim() ? parseInt(quadraticCredits, 10) : null;
              const period = creditPeriodDays.trim() ? parseInt(creditPeriodDays, 10) : null;
              await orgsApi.update(org.slug, { quadratic_credits: credits, credit_period_days: period });
              addToast('Credit allowance saved', 'success');
            } catch {
              addToast('Failed to save credit allowance', 'error');
            } finally {
              setSavingCredits(false);
            }
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}
        >
          <input
            type="number"
            min={1}
            value={quadraticCredits}
            onChange={(e) => setQuadraticCredits(e.target.value)}
            placeholder="e.g. 100"
            style={{ width: 80, padding: '0 var(--space-2)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
          />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>credits,</span>
          <input
            type="number"
            min={1}
            value={creditPeriodDays}
            onChange={(e) => setCreditPeriodDays(e.target.value)}
            placeholder="e.g. 30"
            style={{ width: 70, padding: '0 var(--space-2)', height: 32, border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)' }}
          />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-fg-muted)' }}>day period (blank = manual only)</span>
          <Button type="submit" size="sm" disabled={savingCredits}>{savingCredits ? 'Saving…' : 'Save'}</Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={allocatingCredits || !org.quadratic_credits}
            onClick={async () => {
              setAllocatingCredits(true);
              try {
                const { count } = await orgsApi.allocateCredits(org.slug);
                addToast(`Credits allocated to ${count} member${count !== 1 ? 's' : ''}`, 'success');
              } catch {
                addToast('Failed to allocate credits', 'error');
              } finally {
                setAllocatingCredits(false);
              }
            }}
          >
            {allocatingCredits ? 'Allocating…' : 'Allocate now'}
          </Button>
        </form>
      </section>

      {/* Data */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Data export</h3>
        <p className={styles.sectionHint}>Download a full JSON archive of proposals, votes, delegations, and members for backup or migration.</p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <a
            href={`/api/orgs/${org.slug}/export`}
            download={`${org.slug}-export.json`}
            style={{ display: 'inline-block' }}
          >
            <Button size="sm" variant="secondary" type="button">Download org data (.json)</Button>
          </a>
          <a
            href={`/api/orgs/${org.slug}/audit-log/export`}
            download={`${org.slug}-audit-log.csv`}
            style={{ display: 'inline-block' }}
          >
            <Button size="sm" variant="secondary" type="button">Download audit log (.csv)</Button>
          </a>
          <a
            href={`/api/orgs/${org.slug}/proposals/snapshot`}
            download={`${org.slug}-snapshot.json`}
            style={{ display: 'inline-block' }}
          >
            <Button size="sm" variant="secondary" type="button">Download Snapshot export (.json)</Button>
          </a>
        </div>
      </section>

      {/* Bulk import */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Bulk import proposals</h3>
        <p className={styles.sectionHint}>
          Paste a JSON array of proposals to create them all at once. Each object must have <code>title</code> and <code>topic_id</code>. Optional fields: <code>description</code>, <code>closes_at</code>, <code>status</code> ("open" or "draft"), <code>tags</code>.
        </p>
        <textarea
          rows={8}
          value={importJson}
          onChange={(e) => { setImportJson(e.target.value); setImportResult(null); }}
          placeholder={'[\n  { "title": "Proposal 1", "topic_id": "uuid-here", "description": "..." },\n  { "title": "Proposal 2", "topic_id": "uuid-here" }\n]'}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 'var(--text-sm)', padding: 'var(--space-3)', border: 'var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-fg)', resize: 'vertical', boxSizing: 'border-box' }}
        />
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Button
            size="sm"
            disabled={importing || !importJson.trim()}
            onClick={async () => {
              let parsed: unknown;
              try { parsed = JSON.parse(importJson); } catch { addToast('Invalid JSON', 'error'); return; }
              if (!Array.isArray(parsed)) { addToast('JSON must be an array', 'error'); return; }
              setImporting(true);
              setImportResult(null);
              try {
                const result = await proposalsApi.bulkImport(org.slug, parsed as Parameters<typeof proposalsApi.bulkImport>[1]);
                setImportResult(result);
                if (result.errors.length === 0) {
                  addToast(`Imported ${result.created} proposal${result.created !== 1 ? 's' : ''}`, 'success');
                  setImportJson('');
                } else {
                  addToast(`Imported ${result.created} proposals, ${result.errors.length} failed`, 'error');
                }
              } catch (err) {
                addToast(err instanceof Error ? err.message : 'Import failed', 'error');
              } finally {
                setImporting(false);
              }
            }}
          >
            {importing ? 'Importing…' : 'Import proposals'}
          </Button>
          {importResult && (
            <span style={{ fontSize: 'var(--text-sm)', color: importResult.errors.length ? 'var(--color-error)' : 'var(--color-fg-muted)' }}>
              {importResult.created} created{importResult.errors.length > 0 ? `, ${importResult.errors.length} failed` : ''}
            </span>
          )}
        </div>
        {importResult && importResult.errors.length > 0 && (
          <ul style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--color-error)', paddingLeft: 'var(--space-4)' }}>
            {importResult.errors.map((e) => (
              <li key={e.index}>Row {e.index + 1}: {e.message}</li>
            ))}
          </ul>
        )}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Features</h3>
        <p className={styles.sectionHint}>Control which features are visible to members. Disabled features are hidden entirely, not locked.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem' }}>
          {FEATURE_DEFS.map(({ key, label, desc }) => {
            const enabled = (org.features ?? DEFAULT_FEATURES)[key as keyof OrgFeatures] ?? true;
            return (
              <label key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', cursor: 'pointer', padding: '0.5rem 0.75rem', border: '1px solid #eee', borderRadius: 4, background: enabled ? '#fafafa' : 'transparent' }}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={async (e) => {
                    const newFeatures = { ...(org.features ?? DEFAULT_FEATURES), [key]: e.target.checked };
                    setSavingFeatures(true);
                    try {
                      await orgsApi.update(org.slug, { features: newFeatures as OrgFeatures });
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Failed to update features', 'error');
                    } finally {
                      setSavingFeatures(false);
                    }
                  }}
                  style={{ marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 12, color: '#888' }}>{desc}</div>
                </div>
              </label>
            );
          })}
        </div>
        {savingFeatures && <p className={styles.sectionHint} style={{ margin: 0 }}>Saving…</p>}
      </section>

      {/* Nonprofit status */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Nonprofit status</h3>
        {org.plan === 'nonprofit' ? (
          <div>
            <p className={styles.sectionHint} style={{ color: '#2d9a4e' }}>✓ This organisation has nonprofit status — all Pro features are included free of charge.</p>
            <p className={styles.sectionHint}>{(org as { nonprofit_name?: string | null }).nonprofit_name}{(org as { nonprofit_country?: string | null }).nonprofit_country ? ` · ${(org as { nonprofit_country?: string | null }).nonprofit_country}` : ''}</p>
          </div>
        ) : (
          <div>
            <p className={styles.sectionHint}>Registered charities, nonprofits, and community organisations get all Pro features free. Enter your organisation's registered details to apply.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', maxWidth: 400 }}>
              <input
                type="text"
                placeholder="Registered organisation name *"
                value={nonprofitName}
                onChange={(e) => setNonprofitName(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
              />
              <input
                type="text"
                placeholder="Charity / registration number (optional)"
                value={nonprofitRegNumber}
                onChange={(e) => setNonprofitRegNumber(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
              />
              <input
                type="text"
                placeholder="Country (optional)"
                value={nonprofitCountry}
                onChange={(e) => setNonprofitCountry(e.target.value)}
                style={{ padding: '0.4rem 0.6rem', fontSize: 13, border: '1px solid #ddd', borderRadius: 4 }}
              />
            </div>
            <button
              type="button"
              disabled={applyingNonprofit || !nonprofitName.trim()}
              onClick={async () => {
                setApplyingNonprofit(true);
                try {
                  await orgsApi.applyNonprofit(org.slug, {
                    nonprofit_name: nonprofitName,
                    nonprofit_registration_number: nonprofitRegNumber || undefined,
                    nonprofit_country: nonprofitCountry || undefined,
                  });
                  addToast('Nonprofit status applied', 'success');
                } catch (err) {
                  addToast(err instanceof Error ? err.message : 'Failed to apply', 'error');
                } finally {
                  setApplyingNonprofit(false);
                }
              }}
              style={{ padding: '0.4rem 1rem', background: '#111', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer' }}
            >
              {applyingNonprofit ? 'Applying…' : 'Apply for nonprofit status'}
            </button>
          </div>
        )}
      </section>

      {/* Danger zone */}
      <section className={styles.dangerSection}>
        <h3 className={styles.dangerTitle}>Danger zone</h3>
        <p className={styles.sectionHint}>
          Permanently delete this organisation and all its proposals, votes, and delegations. This cannot be undone.
        </p>
        <ConfirmButton
          label="Delete organisation"
          confirmLabel="Yes, delete permanently"
          onConfirm={deleteOrg}
          disabled={deleting}
          style={{ fontSize: 'var(--text-sm)', padding: '0 var(--space-3)', height: '32px', color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          confirmStyle={{ color: 'var(--color-error)', border: '1px solid var(--color-error)', background: 'none', borderRadius: 'var(--radius-sm)' }}
        />
      </section>
    </div>
  );
}
