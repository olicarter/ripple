// Which Electric shapes a browser may request, and how each is narrowed.
//
// The browser never talks to Electric directly: ElectricController builds the
// table, columns and WHERE clause here, server-side, from the caller's session.
// Column lists are allowlists on purpose: a new column (e.g. another secret)
// stays private until it is added below.

export interface ShapeViewer {
  userId: string | null;
  /** Orgs the viewer is an approved member of. */
  memberOrgIds: string[];
  /** Orgs with is_public = true. */
  publicOrgIds: string[];
}

export interface ShapeDefinition {
  columns?: string[];
  where?: string;
}

export class ShapeForbiddenError extends Error {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_WHERE_RE = /^\s*organisation_id\s*=\s*'([^']+)'\s*$/;

// Everything except invite_token, stripe_*, slack_bot_token, oidc_client_secret,
// scim_token and discord_webhook_url. Admins read those via
// GET /api/orgs/:slug/admin-settings.
const ORGANISATION_COLUMNS = [
  'id', 'name', 'slug', 'description', 'created_at', 'proposal_creation_role', 'topic_creation_role',
  'default_voting_duration_days', 'default_threshold', 'voting_visibility', 'default_quorum', 'is_public',
  'veto_role', 'min_endorsements', 'require_member_approval', 'proposal_templates', 'weight_mode',
  'allowed_email_domains', 'plan', 'slack_team_id', 'slack_team_name', 'slack_channel_id', 'slack_channel_name',
  'primary_color', 'logo_url', 'data_retention_months', 'quadratic_credits', 'credit_period_days',
  'credits_allocated_at', 'email_from_name', 'email_from_address', 'boost_threshold', 'oidc_issuer',
  'oidc_client_id', 'sso_required', 'custom_domain', 'custom_domain_verified', 'custom_domain_verified_at',
  'org_type', 'features', 'nonprofit_name', 'nonprofit_registration_number', 'nonprofit_country',
];

// No unsubscribe_token.
const MEMBERSHIP_COLUMNS = [
  'id', 'organisation_id', 'user_id', 'role', 'joined_at', 'invited_by', 'status', 'weight',
  'email_notifications_enabled', 'email_digest_enabled', 'credits_balance',
];

const PUBLIC_USER_COLUMNS = ['id', 'name', 'avatar_url', 'bio', 'created_at'];
const MEMBER_USER_COLUMNS = [...PUBLIC_USER_COLUMNS, 'email', 'email_verified'];

// Tables synced per org; the client must scope them with `organisation_id = '<id>'`.
const ORG_SCOPED_TABLES = new Set([
  'topics', 'proposals', 'delegations', 'votes', 'comments', 'comment_reactions', 'arguments',
  'proposal_options',
]);

function inList(column: string, ids: string[]): string {
  // Electric rejects `IN ()`; an always-false predicate on a NOT NULL column is the empty set.
  if (ids.length === 0) return `${column} IS NULL`;
  return `${column} IN (${ids.map((id) => `'${id}'`).join(', ')})`;
}

export function parseOrgWhere(where: string | undefined): string | null {
  const match = where ? ORG_WHERE_RE.exec(where) : null;
  if (!match || !UUID_RE.test(match[1])) return null;
  return match[1].toLowerCase();
}

/**
 * Resolve the shape a viewer gets for `table`. `requestedWhere` is only used to
 * pick the org for org-scoped tables. Throws ShapeForbiddenError if not allowed.
 */
export function resolveShape(
  table: string,
  requestedWhere: string | undefined,
  viewer: ShapeViewer,
  coMemberIds: () => Promise<string[]>,
): Promise<ShapeDefinition> | ShapeDefinition {
  const visibleOrgIds = [...new Set([...viewer.memberOrgIds, ...viewer.publicOrgIds])];

  switch (table) {
    case 'organisations':
      return { columns: ORGANISATION_COLUMNS };

    case 'memberships':
      return {
        columns: MEMBERSHIP_COLUMNS,
        where: viewer.userId
          ? `user_id = '${viewer.userId}' OR ${inList('organisation_id', visibleOrgIds)}`
          : inList('organisation_id', viewer.publicOrgIds),
      };

    case 'users':
      if (!viewer.userId) return { columns: PUBLIC_USER_COLUMNS };
      // Signed-in viewers also see email, so only for themselves and people they share an org with.
      return coMemberIds().then((ids) => ({
        columns: MEMBER_USER_COLUMNS,
        where: inList('id', [...new Set([viewer.userId!, ...ids])]),
      }));
  }

  if (!ORG_SCOPED_TABLES.has(table)) {
    throw new ShapeForbiddenError(`Table "${table}" is not available`);
  }

  const orgId = parseOrgWhere(requestedWhere);
  if (!orgId) {
    throw new ShapeForbiddenError(`"${table}" must be filtered with organisation_id = '<uuid>'`);
  }
  if (!visibleOrgIds.includes(orgId)) {
    throw new ShapeForbiddenError('Not a member of this organisation');
  }

  let where = `organisation_id = '${orgId}'`;
  if (table === 'proposals') {
    // Drafts are visible to their author only.
    where += viewer.userId
      ? ` AND (status <> 'draft' OR author_id = '${viewer.userId}')`
      : ` AND status <> 'draft'`;
  }
  return { where };
}
