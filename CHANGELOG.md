# Changelog

All notable changes to Ripple are documented in this file.

## [Unreleased]

### Security
- Live sync now goes through an authenticated API proxy (`/api/electric/v1/shape`) instead of exposing Electric directly. Secrets (Slack/OIDC/SCIM/invite tokens, Stripe IDs, verification and unsubscribe tokens) are no longer synced, private orgs' data requires membership, emails only reach co-members and drafts only their author
- Other members' votes on anonymous proposals, and on open proposals in orgs that hide votes until close, are no longer synced to browsers
- Votes can only be cast, changed or deleted by the voter; previously any signed-in user could vote as, or edit the vote of, anyone
- Users can only update or delete their own account; `GET /api/users` and `GET /api/orgs/:slug` return public fields only; the unauthenticated `GET /api/votes` listing is removed

### Fixed
- Fresh databases migrate cleanly (migrations 058–062 ran before the initial schema)
- Multiple-choice options sync (`proposal_options` was missing from the Electric publication)
- Admin feature toggles respond immediately instead of waiting for the sync round-trip

## [0.31.0] — 2026-05-13

### Added
- **Quadratic voting** — proposals can enable quadratic voting; members spend credits (K votes cost K² credits) to express preference intensity; org admins set a credits allowance and allocate per period; credit decay auto-reallocates on a configurable schedule
- **Snapshot.org export** — admins can download org proposals in Snapshot-compatible JSON format
- **Protected (constitutional) topics** — admins mark topics as constitutional; proposals in these topics require ≥66% supermajority and a minimum 7-day deliberation period; outcomes are cryptographically signed and stored as a tamper-evident audit record
- **Conviction voting** — vote weight grows with time held without changing
- **Jury selection** — moderators can randomly assign a subset of members as a jury; quorum is met when all jury members have voted
- **Discord webhooks** — post proposal open/close notifications to a Discord channel via webhook URL
- **Bulk proposal import** — admins paste a JSON array to create many proposals at once
- **Random jury** — random subset of members selected to vote; jury quorum override

### Changed
- Date/number formatting now uses consistent `Intl.DateTimeFormat` / `Intl.NumberFormat` helpers across all pages

## [0.30.0] — 2026-05-12

### Added
- **Quote reply in comments** — reply to specific comments with quote context
- **@mention autocomplete** — type `@` in comments to mention org members

## [0.29.0] — 2026-05-11

### Added
- **In-app notification centre** — bell icon with unread badge, notification list with read tracking
- **Weighted voting** — per-member vote weight with manual or role-based modes

## [0.28.0] — 2026-05-10

### Added
- **Passkey authentication** — register and login with WebAuthn passkeys
- **Email magic-link** — passwordless login via emailed link
- **Avatar upload** — profile photo stored in object storage
- **Email digest** — weekly digest of org activity for members
- **SOC 2 audit log** — structured audit log with CSV export
- **GDPR data export** — per-user personal data archive
- **Data retention** — auto-delete closed proposals after configured months
- **API keys** — org-scoped API keys for REST access
- **Slack integration** — post proposal events to a Slack channel
- **Outbound webhooks** — configurable webhooks for `proposal.opened`, `proposal.closed`, `vote.cast`
- **Calendar export** — `.ics` download for proposals with deadlines
- **Org analytics dashboard** — participation rates, top voters, topic stats
- **Decision record** — paginated log of all closed proposals with outcomes
- **Proposal watching** — watch/unwatch proposals for notifications
- **Vote receipt** — cryptographic receipt for a voter's cast vote
- **Right to erasure** — members can anonymise their account
- **Custom branding** — per-org primary colour and logo
- **Multiple proposal types** — discussion, temperature check, consent, approval, score voting, ranked choice, petition, amendment
- **Dynamic quorum** — quorum scales with proposal impact level
- **Supermajority threshold** — configurable threshold above 50%
- **Deliberation periods** — proposals can have a deliberation phase before voting opens
- **Delegation chains** — liquid democracy with topic-scoped delegations and chain display
- **Proposal endorsements** — minimum endorsement gates before a proposal can be published
- **Proposal amendments** — draft an amendment to an open proposal; auto-applies if passed
- **Proposal reactions** — emoji reactions on proposals
- **Comment reactions** — emoji reactions on comments
- **Comment moderation** — hide/unhide and pin/unpin comments
- **Proposal tagging** — tag proposals with custom labels
- **Proposal pinning** — pin proposals to the top of the list
- **Impact levels** — low / medium / high / constitutional impact classification
- **Petition mode** — gather signatures to transition a proposal to a vote
- **Proposal links** — link proposals as supersedes / related_to / blocks / depends_on
- **Proposal templates** — org-level templates for common proposal types
- **Veto power** — moderators or admins can block a proposal
- **Blind voting** — org-level visibility setting to hide votes until proposal closes
- **Anonymous voting** — per-proposal anonymous voting mode
- **Proposal scheduling** — set a future `opens_at` date
- **Dark mode** — system-preference-aware dark theme
- **Global error boundary** — user-friendly error page with reload prompt
- **Offline detection** — banner when the user loses network connectivity
- **Rate limiting** — API rate limiting to prevent abuse
- **Security headers** — `helmet` middleware for HSTS, X-Frame-Options, and other security headers
