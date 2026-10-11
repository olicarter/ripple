export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem('ripple_user');
      window.location.reload();
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.message === 'string') message = body.message;
      else if (Array.isArray(body.message) && body.message.length > 0) message = body.message[0];
    } catch { /* ignore parse error — fall back to default */ }
    throw new Error(message);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface Passkey {
  id: string;
  userId: string;
  createdAt: string;
  transports: string[] | null;
}

export const authApi = {
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  listPasskeys: () => request<Passkey[]>('/auth/passkeys'),
  addPasskeyBegin: () => request<never>('/auth/add-passkey/begin', { method: 'POST' }),
  addPasskeyFinish: (credential: unknown) =>
    request<{ success: boolean }>('/auth/add-passkey/finish', { method: 'POST', body: JSON.stringify(credential) }),
  deletePasskey: (id: string) =>
    request<{ success: boolean }>(`/auth/passkeys/${id}`, { method: 'DELETE' }),
  verifyEmail: (token: string) =>
    request<{ success: boolean }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  magicLinkBegin: (email: string) =>
    request<{ success: boolean }>('/auth/magic/begin', { method: 'POST', body: JSON.stringify({ email }) }),
  magicLinkVerify: (token: string) =>
    request<User>(`/auth/magic/verify?token=${encodeURIComponent(token)}`, { method: 'POST' }),
};

export type OrgType = 'company' | 'cooperative' | 'community' | 'dao' | 'nonprofit' | 'other';

export interface OrgFeatures {
  delegation: boolean;
  advanced_voting: boolean;
  argumentation: boolean;
  proposal_queue: boolean;
  sentiment: boolean;
}

export const DEFAULT_FEATURES: OrgFeatures = {
  delegation: true,
  advanced_voting: true,
  argumentation: true,
  proposal_queue: true,
  sentiment: true,
};

export const ORG_TYPE_FEATURES: Record<OrgType, OrgFeatures> = {
  company:     { delegation: false, advanced_voting: false, argumentation: true,  proposal_queue: false, sentiment: true  },
  cooperative: { delegation: true,  advanced_voting: false, argumentation: true,  proposal_queue: false, sentiment: true  },
  community:   { delegation: false, advanced_voting: false, argumentation: false, proposal_queue: false, sentiment: false },
  dao:         { delegation: true,  advanced_voting: true,  argumentation: true,  proposal_queue: true,  sentiment: true  },
  nonprofit:   { delegation: false, advanced_voting: false, argumentation: true,  proposal_queue: false, sentiment: false },
  other:       { delegation: true,  advanced_voting: true,  argumentation: true,  proposal_queue: true,  sentiment: true  },
};

export interface MutationResult<T> {
  item: T;
  txid: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  bio: string | null;
  email_verified: boolean;
  avatar_url: string | null;
  created_at: string;
  [key: string]: unknown;
}

// Admin-only org fields, which the synced Organisation row deliberately omits.
export interface OrgAdminSettings {
  invite_token: string | null;
  discord_webhook_url: string | null;
  scim_enabled: boolean;
}

export interface Organisation {
  id: string;
  name: string;
  slug: string;
  description: string;
  invite_token: string | null;
  proposal_creation_role: 'member' | 'moderator' | 'admin';
  topic_creation_role: 'member' | 'moderator' | 'admin';
  default_voting_duration_days: number | null;
  default_threshold: number;
  voting_visibility: 'public' | 'hidden';
  default_quorum: number | null;
  is_public: boolean;
  veto_role: 'moderator' | 'admin';
  min_endorsements: number;
  require_member_approval: boolean;
  weight_mode: 'manual' | 'by_role';
  proposal_templates: Array<{
    id: string;
    name: string;
    description: string;
    proposal_type: 'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent' | 'approval' | 'score_voting' | 'ranked_choice' | 'petition' | 'amendment';
    threshold: number;
  }>;
  allowed_email_domains: string[];
  plan: 'free' | 'pro' | 'nonprofit';
  nonprofit_name: string | null;
  nonprofit_registration_number: string | null;
  nonprofit_country: string | null;
  stripe_customer_id: string | null;
  slack_team_id: string | null;
  slack_team_name: string | null;
  slack_channel_id: string | null;
  slack_channel_name: string | null;
  primary_color: string | null;
  logo_url: string | null;
  data_retention_months: number | null;
  discord_webhook_url: string | null;
  quadratic_credits: number | null;
  credit_period_days: number | null;
  credits_allocated_at: string | null;
  email_from_name: string | null;
  email_from_address: string | null;
  boost_threshold: number | null;
  oidc_issuer: string | null;
  oidc_client_id: string | null;
  sso_required: boolean;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  org_type: OrgType | null;
  features: OrgFeatures;
  created_at: string;
  [key: string]: unknown;
}

export interface Membership {
  id: string;
  organisation_id: string;
  user_id: string;
  role: 'admin' | 'moderator' | 'member' | 'observer';
  status: 'pending' | 'approved';
  weight: number;
  joined_at: string;
  invited_by: string | null;
  [key: string]: unknown;
}

export interface Topic {
  id: string;
  organisation_id: string;
  name: string;
  description: string;
  is_constitutional: boolean;
  created_at: string;
  [key: string]: unknown;
}

export interface Proposal {
  id: string;
  organisation_id: string;
  topic_id: string;
  author_id: string | null;
  title: string;
  description: string;
  status: 'draft' | 'open' | 'closed' | 'withdrawn';
  proposal_type: 'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent' | 'approval' | 'score_voting' | 'ranked_choice' | 'petition' | 'amendment';
  threshold: number;
  quorum: number | null;
  quorum_type: 'soft' | 'hard';
  outcome: 'implemented' | 'not_implemented' | 'in_progress' | null;
  deliberation_ends_at: string | null;
  created_at: string;
  opens_at: string | null;
  closes_at: string | null;
  closed_at: string | null;
  pinned: boolean;
  tags: string[];
  impact_level: 'low' | 'medium' | 'high' | 'constitutional' | null;
  signature_threshold: number | null;
  parent_proposal_id: string | null;
  amendment_text: string | null;
  anonymous_voting: boolean;
  conviction_voting: boolean;
  quadratic_voting: boolean;
  jury_size: number | null;
  [key: string]: unknown;
}

export interface Delegation {
  id: string;
  organisation_id: string;
  delegator_id: string;
  delegate_id: string;
  topic_id: string | null;
  expires_at: string | null;
  fallback_abstain_hours: number | null;
  weight_fraction: number;
  created_at: string;
  [key: string]: unknown;
}

export interface Vote {
  id: string;
  proposal_id: string;
  organisation_id: string;
  user_id: string;
  choice: 'yes' | 'no' | 'abstain' | null;
  option_id: string | null;
  reason: string | null;
  score: number | null;
  rank_position: number | null;
  vote_count: number;
  created_at: string;
  [key: string]: unknown;
}

export interface ProposalOption {
  id: string;
  proposal_id: string;
  organisation_id: string;
  text: string;
  position: number;
  created_at: string;
  [key: string]: unknown;
}

export interface TallyResult {
  yes: number;
  no: number;
  abstain: number;
  total: number;
  eligible_count: number | null;
  quorum_met: boolean | null;
  options: Array<{ id: string; text: string; count: number; position: number; mean_score?: number; irv_rounds?: Array<{ eliminated: string | null; counts: Record<string, number> }> }>;
}

export interface DelegationVote {
  delegate_id: string;
  choice: string;
}

export interface DelegationChainLink {
  user_id: string;
  name: string;
}

export interface DelegationChain {
  chain: DelegationChainLink[];
  voter: (DelegationChainLink & { choice: string }) | null;
}

export interface Argument {
  id: string;
  proposal_id: string;
  organisation_id: string;
  author_id: string | null;
  side: 'for' | 'against';
  body: string;
  created_at: string;
  [key: string]: unknown;
}

export interface AuditLogEntry {
  id: string;
  org_id: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export const usersApi = {
  create: (data: { id: string; name: string; email: string }) =>
    request<MutationResult<User>>('/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<User, 'name' | 'email' | 'bio' | 'avatar_url'>>) =>
    request<MutationResult<User>>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ txid: number }>(`/users/${id}`, { method: 'DELETE' }),
  getNotificationPreferences: () =>
    request<Record<string, boolean>>('/users/me/notification-preferences'),
  updateNotificationPreferences: (prefs: Record<string, boolean>) =>
    request<Record<string, boolean>>('/users/me/notification-preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    }),
  getOrgEmailPreferences: () =>
    request<Array<{ org_id: string; org_name: string; org_slug: string; email_notifications_enabled: boolean; email_digest_enabled: boolean }>>('/users/me/org-email-preferences'),
  anonymize: () =>
    request<{ success: boolean }>('/users/me/anonymize', { method: 'POST' }),
  exportData: async () => {
    const res = await fetch('/api/users/me/export', { credentials: 'include' });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.blob();
  },
};

export const orgsApi = {
  list: () => request<Organisation[]>('/orgs'),
  get: (slug: string) => request<Organisation>(`/orgs/${slug}`),
  create: (data: { name: string; slug?: string; description?: string; org_type?: OrgType; features?: OrgFeatures }) =>
    request<MutationResult<Organisation>>('/orgs', { method: 'POST', body: JSON.stringify(data) }),
  update: (slug: string, data: Partial<Pick<Organisation, 'name' | 'description' | 'proposal_creation_role' | 'topic_creation_role' | 'default_voting_duration_days' | 'default_threshold' | 'voting_visibility' | 'default_quorum' | 'is_public' | 'veto_role' | 'min_endorsements' | 'require_member_approval' | 'weight_mode' | 'proposal_templates' | 'allowed_email_domains' | 'primary_color' | 'logo_url' | 'data_retention_months' | 'discord_webhook_url' | 'quadratic_credits' | 'credit_period_days' | 'email_from_name' | 'email_from_address' | 'boost_threshold' | 'oidc_issuer' | 'oidc_client_id' | 'sso_required' | 'org_type' | 'features'> & { oidc_client_secret?: string | null }>) =>
    request<MutationResult<Organisation>>(`/orgs/${slug}`, { method: 'PATCH', body: JSON.stringify(data) }),
  transferOwnership: (slug: string, toUserId: string) =>
    request<{ txid: number }>(`/orgs/${slug}/transfer-ownership`, { method: 'POST', body: JSON.stringify({ to_user_id: toUserId }) }),
  delete: (slug: string) =>
    request<{ txid: number }>(`/orgs/${slug}`, { method: 'DELETE' }),
  listMembers: (slug: string) => request<Membership[]>(`/orgs/${slug}/members`),
  addMember: (slug: string, data: { user_id: string; role?: Membership['role'] }) =>
    request<MutationResult<Membership>>(`/orgs/${slug}/members`, { method: 'POST', body: JSON.stringify(data) }),
  updateMemberRole: (slug: string, userId: string, role: Membership['role']) =>
    request<MutationResult<Membership>>(`/orgs/${slug}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  updateMemberWeight: (slug: string, userId: string, weight: number) =>
    request<MutationResult<Membership>>(`/orgs/${slug}/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ weight }) }),
  removeMember: (slug: string, userId: string) =>
    request<{ txid: number }>(`/orgs/${slug}/members/${userId}`, { method: 'DELETE' }),
  joinViaToken: (slug: string, token: string) =>
    request<MutationResult<Membership>>(`/orgs/${slug}/join`, { method: 'POST', body: JSON.stringify({ token }) }),
  joinPublic: (slug: string) =>
    request<MutationResult<Membership>>(`/orgs/${slug}/join`, { method: 'POST', body: JSON.stringify({}) }),
  approveMember: (slug: string, userId: string) =>
    request<MutationResult<Membership>>(`/orgs/${slug}/members/${userId}/approve`, { method: 'POST' }),
  rejectMember: (slug: string, userId: string) =>
    request<{ txid: number }>(`/orgs/${slug}/members/${userId}/reject`, { method: 'POST' }),
  getAdminSettings: (slug: string) =>
    request<OrgAdminSettings>(`/orgs/${slug}/admin-settings`),
  generateInviteToken: (slug: string) =>
    request<MutationResult<Organisation>>(`/orgs/${slug}/invite-token`, { method: 'POST' }),
  revokeInviteToken: (slug: string) =>
    request<MutationResult<Organisation>>(`/orgs/${slug}/invite-token`, { method: 'DELETE' }),
  generateScimToken: (slug: string) =>
    request<{ token: string; item: Organisation; txid: number }>(`/orgs/${slug}/scim-token`, { method: 'POST' }),
  revokeScimToken: (slug: string) =>
    request<MutationResult<Organisation>>(`/orgs/${slug}/scim-token`, { method: 'DELETE' }),
  setCustomDomain: (slug: string, domain: string | null) =>
    request<{ item: Organisation; txid: number; verification_token?: string }>(`/orgs/${slug}/custom-domain`, { method: 'PATCH', body: JSON.stringify({ domain }) }),
  verifyCustomDomain: (slug: string) =>
    request<{ verified: boolean; message: string }>(`/orgs/${slug}/custom-domain/verify`, { method: 'POST' }),
  listAuditLog: (slug: string, page = 1, pageSize = 50) =>
    request<{ items: AuditLogEntry[]; total: number; page: number; pageSize: number; totalPages: number }>(`/orgs/${slug}/audit-log?page=${page}&pageSize=${pageSize}`),
  getPublicResults: (slug: string) => request<{ org: Organisation; proposals: Proposal[] }>(`/orgs/${slug}/results`),
  searchMembers: (slug: string, q: string) =>
    request<{ id: string; name: string }[]>(`/orgs/${slug}/members/search?q=${encodeURIComponent(q)}`),
  getDelegationWeights: (slug: string) =>
    request<Array<{ user_id: string; carried_weight: number }>>(`/orgs/${slug}/delegation-weights`),
  getAnalytics: (slug: string) =>
    request<OrgAnalytics>(`/orgs/${slug}/analytics`),
  getDecisionRecord: (slug: string, page = 1, pageSize = 25) =>
    request<{ items: DecisionEntry[]; total: number; page: number; pageSize: number; totalPages: number }>(`/orgs/${slug}/decisions?page=${page}&pageSize=${pageSize}`),
  listInvites: (slug: string) =>
    request<OrgInvite[]>(`/orgs/${slug}/invites`),
  sendInvite: (slug: string, email: string) =>
    request<{ id: string }>(`/orgs/${slug}/invites`, { method: 'POST', body: JSON.stringify({ email }) }),
  cancelInvite: (slug: string, inviteId: string) =>
    request<void>(`/orgs/${slug}/invites/${inviteId}`, { method: 'DELETE' }),
  getInviteInfo: (token: string) =>
    request<{ org: { id: string; name: string; description: string; slug: string }; email: string }>(`/orgs/invites/accept?token=${encodeURIComponent(token)}`),
  acceptInvite: (token: string) =>
    request<{ item: unknown; txid: number }>(`/orgs/invites/accept?token=${encodeURIComponent(token)}`, { method: 'POST' }),
  getEmailPreferences: (slug: string) =>
    request<{ email_notifications_enabled: boolean; email_digest_enabled: boolean }>(`/orgs/${slug}/email-preferences`),
  updateEmailPreferences: (slug: string, prefs: { email_notifications_enabled?: boolean; email_digest_enabled?: boolean }) =>
    request<{ email_notifications_enabled: boolean; email_digest_enabled: boolean }>(`/orgs/${slug}/email-preferences`, { method: 'PATCH', body: JSON.stringify(prefs) }),
  sendDigest: (slug: string) =>
    request<{ sent: number }>(`/orgs/${slug}/send-digest`, { method: 'POST' }),
  unsubscribeByToken: (token: string) =>
    request<{ success: boolean; org_name: string }>(`/orgs/unsubscribe?token=${encodeURIComponent(token)}`),
  allocateCredits: (slug: string) =>
    request<{ count: number }>(`/orgs/${slug}/credits/allocate`, { method: 'POST' }),
  applyNonprofit: (slug: string, data: { nonprofit_name: string; nonprofit_registration_number?: string; nonprofit_country?: string }) =>
    request<MutationResult<Organisation>>(`/orgs/${slug}/nonprofit`, { method: 'POST', body: JSON.stringify(data) }),
  exportDecisionRecord: async (slug: string): Promise<void> => {
    const res = await fetch(`/api/orgs/${slug}/decisions/export`, { credentials: 'include' });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decisions-${slug}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};

export const slackApi = {
  getConnectUrl: (orgSlug: string) =>
    request<{ url: string }>(`/slack/connect/${orgSlug}`),
  listChannels: (orgId: string) =>
    request<Array<{ id: string; name: string }>>(`/slack/${orgId}/channels`),
  setChannel: (orgId: string, channelId: string) =>
    request<{ ok: boolean }>(`/slack/${orgId}/channel`, { method: 'POST', body: JSON.stringify({ channel_id: channelId }) }),
  disconnect: (orgId: string) =>
    request<{ ok: boolean }>(`/slack/${orgId}/disconnect`, { method: 'DELETE' }),
};

export interface WebhookEndpoint {
  id: string;
  org_id: string;
  url: string;
  events: string[];
  active: boolean;
  created_at: string;
}

export const webhooksApi = {
  list: (slug: string) =>
    request<WebhookEndpoint[]>(`/orgs/${slug}/webhooks`),
  create: (slug: string, url: string, events: string[]) =>
    request<WebhookEndpoint & { secret: string }>(`/orgs/${slug}/webhooks`, { method: 'POST', body: JSON.stringify({ url, events }) }),
  delete: (slug: string, id: string) =>
    request<void>(`/orgs/${slug}/webhooks/${id}`, { method: 'DELETE' }),
};

export interface ApiKeyRecord {
  id: string;
  organisation_id: string;
  name: string;
  key_preview: string;
  created_by_user_id: string;
  created_at: string;
  last_used_at: string | null;
}

export const apiKeysApi = {
  list: (slug: string) =>
    request<ApiKeyRecord[]>(`/orgs/${slug}/api-keys`),
  create: (slug: string, name: string) =>
    request<{ key: string; record: ApiKeyRecord }>(`/orgs/${slug}/api-keys`, { method: 'POST', body: JSON.stringify({ name }) }),
  revoke: (slug: string, keyId: string) =>
    request<void>(`/orgs/${slug}/api-keys/${keyId}`, { method: 'DELETE' }),
};

export const billingApi = {
  getStatus: (orgId: string) =>
    request<{ plan: 'free' | 'pro' | 'nonprofit'; memberCount: number; memberLimit: number | null; canUpgrade: boolean }>(`/billing/${orgId}/status`),
  createCheckout: (orgId: string, returnUrl: string) =>
    request<{ url: string }>(`/billing/${orgId}/checkout`, { method: 'POST', body: JSON.stringify({ return_url: returnUrl }) }),
  createPortal: (orgId: string, returnUrl: string) =>
    request<{ url: string }>(`/billing/${orgId}/portal`, { method: 'POST', body: JSON.stringify({ return_url: returnUrl }) }),
};

export interface OrgAnalytics {
  totalProposals: number;
  openProposals: number;
  closedProposals: number;
  totalVotes: number;
  totalMembers: number;
  participationRate: number;
  avgVotesPerProposal: number;
  proposalsByMonth: Array<{ month: string; count: number }>;
  topVoters: Array<{ user_id: string; name: string; voteCount: number }>;
  proposalOutcomes: { passed: number; failed: number; withdrawn: number };
  topicStats: Array<{ topic_id: string; topic_name: string; proposalCount: number; avgParticipation: number; passRate: number }>;
}

export interface DecisionEntry {
  proposal: {
    id: string;
    title: string;
    proposal_type: string;
    topic_name: string;
    author_name: string | null;
    closed_at: string | null;
    threshold: number;
    outcome: 'implemented' | 'not_implemented' | 'in_progress' | null;
    status: string;
    anonymous_voting: boolean;
  };
  tally: { yes: number; no: number; abstain: number } | null;
  result: 'passed' | 'failed' | 'no-votes' | 'withdrawn';
}

export interface OrgInvite {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  invited_by_name: string | null;
}

export const topicsApi = {
  create: (data: { id: string; organisation_id: string; name: string; description?: string }) =>
    request<MutationResult<Topic>>('/topics', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<Topic, 'name' | 'description' | 'is_constitutional'>>) =>
    request<MutationResult<Topic>>(`/topics/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ txid: number }>(`/topics/${id}`, { method: 'DELETE' }),
};

export interface ProposalSignature {
  id: string;
  proposal_id: string;
  organisation_id: string;
  user_id: string;
  created_at: string;
}

export interface ProposalLinkItem {
  id: string;
  link_type: string;
  direction: 'outgoing' | 'incoming';
  other_proposal_id: string;
  other_proposal_title: string;
  other_proposal_status: string;
}

export const proposalLinksApi = {
  list: (proposalId: string) =>
    request<ProposalLinkItem[]>(`/proposals/${proposalId}/links`),
  add: (proposalId: string, data: { target_proposal_id: string; link_type: 'supersedes' | 'related_to' | 'blocks' | 'depends_on' }) =>
    request<{ id: string }>(`/proposals/${proposalId}/links`, { method: 'POST', body: JSON.stringify(data) }),
  remove: (proposalId: string, linkId: string) =>
    request<void>(`/proposals/${proposalId}/links/${linkId}`, { method: 'DELETE' }),
};

export const proposalSignaturesApi = {
  list: (proposalId: string) =>
    request<{ signatures: ProposalSignature[]; count: number }>(`/proposals/${proposalId}/signatures`),
  sign: (proposalId: string) =>
    request<{ signed: boolean; count: number; transitioned: boolean }>(`/proposals/${proposalId}/signatures`, { method: 'POST' }),
  unsign: (proposalId: string) =>
    request<{ count: number }>(`/proposals/${proposalId}/signatures`, { method: 'DELETE' }),
};

export const proposalOptionsApi = {
  create: (proposalId: string, data: { id: string; text: string; position: number }) =>
    request<ProposalOption>(`/proposals/${proposalId}/options`, { method: 'POST', body: JSON.stringify(data) }),
  delete: (proposalId: string, optionId: string) =>
    request<void>(`/proposals/${proposalId}/options/${optionId}`, { method: 'DELETE' }),
};

export const proposalsApi = {
  create: (data: { id: string; organisation_id: string; topic_id: string; title: string; description?: string; closes_at?: string | null; opens_at?: string | null; deliberation_ends_at?: string | null; threshold?: number; quorum?: number | null; quorum_type?: 'soft' | 'hard'; status?: 'open' | 'draft'; proposal_type?: 'standard' | 'discussion' | 'multiple_choice' | 'temperature_check' | 'consent' | 'approval' | 'score_voting' | 'ranked_choice' | 'petition' | 'amendment'; impact_level?: 'low' | 'medium' | 'high' | 'constitutional' | null; signature_threshold?: number | null; parent_proposal_id?: string | null; amendment_text?: string | null; anonymous_voting?: boolean; conviction_voting?: boolean; quadratic_voting?: boolean }) =>
    request<MutationResult<Proposal>>('/proposals', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Pick<Proposal, 'title' | 'description' | 'status' | 'closed_at' | 'closes_at' | 'threshold' | 'tags'>>) =>
    request<MutationResult<Proposal>>(`/proposals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  publish: (id: string) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/publish`, { method: 'POST' }),
  close: (id: string) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/close`, { method: 'POST' }),
  reopen: (id: string) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/reopen`, { method: 'POST' }),
  withdraw: (id: string) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/withdraw`, { method: 'POST' }),
  delete: (id: string) =>
    request<{ txid: number }>(`/proposals/${id}`, { method: 'DELETE' }),
  tally: (id: string) =>
    request<TallyResult>(`/proposals/${id}/tally`),
  myDelegationVote: (id: string) =>
    request<DelegationVote | null>(`/proposals/${id}/my-delegation-vote`),
  myDelegationChain: (id: string) =>
    request<DelegationChain | null>(`/proposals/${id}/my-delegation-chain`),
  versions: (id: string) =>
    request<ProposalVersion[]>(`/proposals/${id}/versions`),
  setOutcome: (id: string, outcome: Proposal['outcome']) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/outcome`, { method: 'POST', body: JSON.stringify({ outcome }) }),
  pin: (id: string) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/pin`, { method: 'POST' }),
  unpin: (id: string) =>
    request<MutationResult<Proposal>>(`/proposals/${id}/unpin`, { method: 'POST' }),
  sendVoteReminder: (id: string) =>
    request<{ count: number }>(`/proposals/${id}/vote-reminder`, { method: 'POST' }),
  listReactions: (id: string) =>
    request<ProposalReaction[]>(`/proposals/${id}/reactions`),
  react: (id: string, emoji: string) =>
    request<ProposalReaction>(`/proposals/${id}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),
  removeReaction: (id: string) =>
    request<void>(`/proposals/${id}/reactions`, { method: 'DELETE' }),
  getWatchStatus: (id: string) =>
    request<{ watching: boolean }>(`/proposals/${id}/watch`),
  watch: (id: string) =>
    request<void>(`/proposals/${id}/watch`, { method: 'PUT' }),
  unwatch: (id: string) =>
    request<void>(`/proposals/${id}/watch`, { method: 'DELETE' }),
  getReceipt: (id: string) =>
    request<Record<string, unknown>>(`/proposals/${id}/receipt`),
  getCarrying: (id: string) =>
    request<Array<{ voter: { user_id: string; name: string }; carrying: Array<{ user_id: string; name: string }> }>>(`/proposals/${id}/carrying`),
  bulkImport: (orgSlug: string, proposals: Array<{ title: string; description?: string; topic_id: string; closes_at?: string; status?: 'open' | 'draft'; tags?: string[] }>) =>
    request<{ created: number; errors: Array<{ index: number; message: string }> }>('/proposals/import', { method: 'POST', body: JSON.stringify({ org_slug: orgSlug, proposals }) }),
  getJury: (id: string) =>
    request<Array<{ user_id: string; name: string; has_voted: boolean }>>(`/proposals/${id}/jury`),
  selectJury: (id: string, size: number) =>
    request<Array<{ user_id: string; name: string }>>(`/proposals/${id}/jury`, { method: 'POST', body: JSON.stringify({ size }) }),
  getConstitutionalOutcome: (id: string) =>
    request<{ outcome: string; hash: string; votes_summary: object; signed_at: string } | null>(`/proposals/${id}/constitutional-outcome`),
};

export interface ProposalReaction {
  id: string;
  proposal_id: string;
  organisation_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  [key: string]: unknown;
}

export interface DelegationHistoryEntry {
  id: string;
  event: 'added' | 'removed';
  organisation_id: string;
  delegator_id: string;
  delegate_id: string;
  topic_id: string | null;
  created_at: string;
  delegator_name: string;
  delegate_name: string;
}

export const delegationsApi = {
  create: (data: { id: string; organisation_id: string; delegator_id: string; delegate_id: string; topic_id?: string | null; expires_at?: string | null; fallback_abstain_hours?: number | null; weight_fraction?: number | null }) =>
    request<MutationResult<Delegation>>('/delegations', { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ txid: number }>(`/delegations/${id}`, { method: 'DELETE' }),
  getHistory: () =>
    request<DelegationHistoryEntry[]>('/delegations/history'),
};

export interface Comment {
  id: string;
  proposal_id: string;
  organisation_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  hidden_by: string | null;
  hidden_reason: string | null;
  pinned_at: string | null;
  parent_comment_id: string | null;
  [key: string]: unknown;
}

export interface CommentReaction {
  id: string;
  comment_id: string;
  organisation_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
  [key: string]: unknown;
}

export interface ProposalVersion {
  id: string;
  proposal_id: string;
  changed_by: string | null;
  title: string;
  description: string;
  created_at: string;
}

export const commentsApi = {
  create: (proposalId: string, data: { id: string; body: string; parent_comment_id?: string | null }) =>
    request<MutationResult<Comment>>(`/proposals/${proposalId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
  edit: (id: string, body: string) =>
    request<MutationResult<Comment>>(`/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  delete: (id: string) =>
    request<{ txid: number }>(`/comments/${id}`, { method: 'DELETE' }),
  react: (commentId: string, emoji: string) =>
    request<{ item?: CommentReaction; deleted?: boolean; txid: number }>(`/comments/${commentId}/reactions`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    }),
  hide: (commentId: string, reason: string) =>
    request<MutationResult<Comment>>(`/comments/${commentId}/hide`, { method: 'POST', body: JSON.stringify({ reason }) }),
  unhide: (commentId: string) =>
    request<MutationResult<Comment>>(`/comments/${commentId}/unhide`, { method: 'POST' }),
  pin: (commentId: string) =>
    request<MutationResult<Comment>>(`/comments/${commentId}/pin`, { method: 'POST' }),
  unpin: (commentId: string) =>
    request<MutationResult<Comment>>(`/comments/${commentId}/unpin`, { method: 'POST' }),
};

export interface Veto {
  id: string;
  proposal_id: string;
  organisation_id: string;
  author_id: string;
  reason: string;
  created_at: string;
  [key: string]: unknown;
}

export interface Endorsement {
  id: string;
  proposal_id: string;
  organisation_id: string;
  user_id: string;
  created_at: string;
  [key: string]: unknown;
}

export const boostsApi = {
  get: (proposalId: string) =>
    request<{ total: number; user_amount: number | null }>(`/proposals/${proposalId}/boosts`),
  boost: (proposalId: string, amount = 1) =>
    request<{ total: number }>(`/proposals/${proposalId}/boost`, { method: 'POST', body: JSON.stringify({ amount }) }),
  unboost: (proposalId: string) =>
    request<{ total: number }>(`/proposals/${proposalId}/boost`, { method: 'DELETE' }),
};

export interface Prediction {
  id: string;
  proposal_id: string;
  user_id: string;
  prediction: 'pass' | 'fail';
  confidence: number;
  created_at: string;
}

export interface PredictionMarket {
  pass_count: number;
  fail_count: number;
  pass_confidence: number;
  fail_confidence: number;
  user_prediction: Prediction | null;
}

export const predictionsApi = {
  get: (proposalId: string) =>
    request<PredictionMarket>(`/proposals/${proposalId}/predictions`),
  predict: (proposalId: string, prediction: 'pass' | 'fail', confidence: number) =>
    request<Prediction>(`/proposals/${proposalId}/predict`, { method: 'POST', body: JSON.stringify({ prediction, confidence }) }),
  unpredict: (proposalId: string) =>
    request<void>(`/proposals/${proposalId}/predict`, { method: 'DELETE' }),
};

export const endorsementsApi = {
  list: (proposalId: string) =>
    request<Endorsement[]>(`/proposals/${proposalId}/endorsements`),
  endorse: (proposalId: string) =>
    request<MutationResult<Endorsement>>(`/proposals/${proposalId}/endorsements`, { method: 'POST' }),
  retract: (proposalId: string) =>
    request<{ txid: number }>(`/proposals/${proposalId}/endorsements`, { method: 'DELETE' }),
};

export const vetoesApi = {
  cast: (proposalId: string, reason: string) =>
    request<MutationResult<Veto>>(`/proposals/${proposalId}/vetoes`, { method: 'POST', body: JSON.stringify({ reason }) }),
  retract: (vetoId: string) =>
    request<{ txid: number }>(`/vetoes/${vetoId}`, { method: 'DELETE' }),
};

export const argumentsApi = {
  create: (proposalId: string, data: { id: string; side: 'for' | 'against'; body: string }) =>
    request<MutationResult<Argument>>(`/proposals/${proposalId}/arguments`, { method: 'POST', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ txid: number }>(`/arguments/${id}`, { method: 'DELETE' }),
};

export interface Notification {
  id: string;
  user_id: string;
  org_id: string | null;
  type: 'proposal.opened' | 'proposal.closed' | 'delegate.voted' | 'member.joined' | 'comment.mention' | 'comment.posted' | 'delegation.added' | 'delegation.removed';
  actor_id: string | null;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export const notificationsApi = {
  list: (limit?: number) =>
    request<Notification[]>(`/notifications${limit ? `?limit=${limit}` : ''}`),
  unreadCount: () =>
    request<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) =>
    request<void>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () =>
    request<void>('/notifications/read-all', { method: 'POST' }),
};

export const votesApi = {
  create: (data: { id: string; proposal_id: string; user_id: string; choice?: Vote['choice']; option_id?: string | null; reason?: string | null }) =>
    request<MutationResult<Vote>>('/votes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { choice?: Vote['choice']; option_id?: string | null; reason?: string | null }) =>
    request<MutationResult<Vote>>(`/votes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ txid: number }>(`/votes/${id}`, { method: 'DELETE' }),
  setApprovals: (proposalId: string, optionIds: string[]) =>
    request<{ txid: number }>(`/votes/proposals/${proposalId}/approvals`, { method: 'POST', body: JSON.stringify({ option_ids: optionIds }) }),
  setScores: (proposalId: string, scores: Array<{ option_id: string; score: number }>) =>
    request<{ txid: number }>(`/votes/proposals/${proposalId}/scores`, { method: 'POST', body: JSON.stringify({ scores }) }),
  setRankings: (proposalId: string, optionIds: string[]) =>
    request<{ txid: number }>(`/votes/proposals/${proposalId}/rankings`, { method: 'POST', body: JSON.stringify({ option_ids: optionIds }) }),
};

export interface ProposalDraft {
  title: string;
  description: string;
  suggested_type: 'standard' | 'discussion' | 'multiple_choice' | 'consent' | 'temperature_check';
  suggested_threshold: number;
}

export interface InterpretedVote {
  choice: 'yes' | 'no' | 'abstain';
  rationale: string;
  confidence: number;
}

export interface ArgumentCluster {
  theme: string;
  for_points: string[];
  against_points: string[];
}

export const aiApi = {
  summarise: (proposal_id: string) =>
    request<{ summary: string }>('/ai/summarise', { method: 'POST', body: JSON.stringify({ proposal_id }) }),
  rewrite: (proposal_id: string) =>
    request<{ rewritten: string }>('/ai/rewrite', { method: 'POST', body: JSON.stringify({ proposal_id }) }),
  clusterArguments: (proposal_id: string) =>
    request<{ clusters: ArgumentCluster[] }>('/ai/cluster-arguments', { method: 'POST', body: JSON.stringify({ proposal_id }) }),
  draftProposal: (description: string) =>
    request<ProposalDraft>('/ai/draft-proposal', { method: 'POST', body: JSON.stringify({ description }) }),
  interpretVote: (proposal_id: string, input: string) =>
    request<InterpretedVote>('/ai/interpret-vote', { method: 'POST', body: JSON.stringify({ proposal_id, input }) }),
  translate: (text: string, targetLanguage: string) =>
    request<{ translated: string }>('/ai/translate', { method: 'POST', body: JSON.stringify({ text, target_language: targetLanguage }) }),
};
