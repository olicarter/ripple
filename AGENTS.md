# Ripple Project - Agent Context

Ripple is a liquid-democracy voting platform for organisations: orgs, topics,
proposals, votes (incl. delegation, blind/anonymous, quadratic, conviction),
comments, and admin/billing features. See `ROADMAP.md` for planned and
completed features and `CHANGELOG.md` for release history.

## Running services
- Do not assume anything is running. Check first (e.g. `curl -s localhost:3001/api/health`,
  `pg_isready -h localhost`) before starting or relying on a service.
- Local dev: `npm run db:up` (docker compose: postgres, electric, redis), then
  `npm run dev` (Caddy + API + web). If the user says a dev server is already
  running, don't start another.
- Cloud/remote sessions (claude.ai/code): the container starts fresh with
  nothing running. `.claude/hooks/session-start.sh` sets it up: `npm ci`,
  installs Caddy, starts `dockerd` (installed but not running by default),
  `docker compose up` for postgres/electric/redis, runs migrations and exports
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. If it hasn't run (e.g. it isn't registered
  as a SessionStart hook in `.claude/settings.json`), run it yourself with
  `CLAUDE_CODE_REMOTE=true CLAUDE_PROJECT_DIR=$PWD .claude/hooks/session-start.sh`.
  It does not start the app: run `npm run dev` (or the API/web/Caddy separately).
  Docker Hub can rate-limit image pulls (HTTP 429); retry `npm run db:up` later.
  Don't reinstall `node_modules` while the app or tests are running.

## Tech stack
npm workspaces monorepo (Node 22): `apps/api`, `apps/web`.

- **API** (`apps/api`): NestJS 11, TypeORM, PostgreSQL 16. Redis (session store
  via connect-redis, BullMQ jobs), `@nestjs/schedule`, Swagger. Integrations: Resend
  (email), Stripe (billing), Slack, Discord, Anthropic SDK (`src/ai`), SCIM.
- **Web** (`apps/web`): React 19, Vite 6, TanStack Router, TanStack DB /
  `react-db` with `electric-db-collection` (live sync from Postgres via
  ElectricSQL), i18next (`src/locales`), CSS modules.
- **Auth**: WebAuthn passkeys (`@simplewebauthn`), magic links, email verification.
- **Proxy**: Caddy (`Caddyfile`) serves `https://localhost:5174`:
  `/api/*` -> API :3001, everything else -> Vite :5173.

## Access control
- `apps/api/src/access/access.service.ts` is the single source of the rules:
  an org's content is visible to everyone if the org is public, otherwise to
  approved members; drafts only to their author; acting in an org needs
  approved membership (optionally a minimum role). Use `assertCanViewProposal`
  / `assertCanActOnProposal` / `assertRole` in controllers; use
  `OptionalAuthGuard` for endpoints anonymous visitors may read.
- Every new endpoint needs an explicit decision: guarded, or public on purpose.
  Never take the acting user's id from the request body; use `req.user.id`.
- Test-mode-only helpers (`/api/auth/test-*`, `/api/votes/test-cast`) let e2e
  setup act for other users; they return 403 unless `NODE_ENV=test`.
- `e2e/tests/access-control.spec.ts` and `vote-integrity.spec.ts` cover these rules.

## Electric sync and data exposure
- Browsers never reach Electric directly. The web app requests shapes from
  `/api/electric/v1/shape`; `apps/api/src/electric` authorises them from the
  session and sets `table`, `columns` and `where` server-side, then adds
  `ELECTRIC_SECRET` (Electric rejects requests without it).
- `electric/shape-policy.ts` holds the rules: allowlisted tables and column
  allowlists (secrets such as invite/SCIM/Slack/OIDC tokens, Stripe IDs,
  verification and unsubscribe tokens are excluded), org-scoped tables require
  `where=organisation_id = '<uuid>'` and membership or a public org, users'
  emails go only to co-members, drafts only to their author.
- New column on a synced table: add it to the allowlist if the browser needs
  it (it is hidden until you do). New synced table: add it to the publication,
  set `REPLICA IDENTITY FULL` (see migrations 081/082) and add it to
  `shape-policy.ts`.
- Admin-only org fields come from `GET /api/orgs/:slug/admin-settings`, not the
  synced row. REST responses must not return those secrets either (see
  `toPublicOrg` / `toPublicUser`).
- Vote privacy: other members' votes on anonymous proposals, and on open
  proposals in orgs with `voting_visibility = 'hidden'`, are not synced; the
  viewer still gets their own. `apps/web/src/utils/votePrivacy.ts` mirrors the
  rule, so for those proposals take counts/results from the tally API, not the
  votes collection. The delegation-chain endpoint deliberately still tells a
  delegator how their delegate voted (it is their vote too).
- Votes are only cast, changed or deleted as the session user. E2E tests that
  need someone else's vote use `createVote` (test-mode `POST /api/votes/test-cast`).

## Ports
| Service | Port |
|---|---|
| Caddy (app entry point) | 5174 (HTTPS, `tls internal`) |
| Vite | 5173 |
| API | 3001 (`API_PORT`), all routes under `/api` |
| ElectricSQL (pinned image; API-only, needs `ELECTRIC_SECRET`) | 3000 |
| Postgres / replica (optional `replica` profile) | 5432 / 5433 |
| Redis | 6379 |
| Parallel test instance (`playwright.config.test.ts`) | Caddy 5274 -> API 3101 |

## Database
- Migrations live in `apps/api/src/db/migrations` (numbered `NNN-name.ts`) and
  run automatically on API boot (`migrationsRun: true`, `synchronize: false`);
  `npm run db:migrate` runs them manually. Add a new numbered migration for
  every schema change; never rely on synchronize. TypeORM orders migrations by
  the timestamp at the end of the class name, so use the next number in the
  current series (`<Name>1748600000NNN`), never a smaller timestamp.
- Seed data: `npm run seed --workspace=apps/api`.
- Entities are colocated with their modules (`*.entity.ts`); main tables include
  users, credentials, organisations, memberships, org_invites, topics, proposals
  (+ options, versions, links, reactions, signatures, boosts), votes,
  delegations, comments, comment_reactions, arguments, endorsements, vetoes,
  predictions, notifications, audit_log, api_keys, webhook_endpoints, magic_links.

## Environment
- With `NODE_ENV=production` the API refuses to start unless its secrets
  (`SESSION_SECRET`, `ELECTRIC_SECRET`, `RECEIPT_SECRET`, `VOTE_EMAIL_SECRET`,
  32+ chars, not the dev defaults) and `DATABASE_URL`, `ORIGIN`, `RP_ID`,
  `APP_URL` are set (`src/config/production-config.ts`). `ORIGIN` also sets
  CORS; `TRUST_PROXY` controls Express's trusted proxy hops.
- `.env` is **not** loaded automatically (no dotenv); the API falls back to
  hard-coded local defaults, e.g. `DATABASE_URL=postgresql://postgres:password@localhost:5432/ripple`,
  `ELECTRIC_SECRET=ripple-dev-electric-secret` (must match docker-compose),
  `RP_ID=localhost`. BullMQ uses `redis://localhost:6379` by default; sessions
  use Redis only if `REDIS_URL` is set (in-memory otherwise). Export variables
  in the shell to override.
- Optional integration keys (Resend, Stripe, Slack, Anthropic, etc.) are listed in
  `ROADMAP.md`; features degrade or are disabled without them.

## API modules (`apps/api/src`)
Controllers (prefix `/api`): `auth`, `users`, `orgs`, `electric`, `orgs/:slug/api-keys`,
`orgs/:slug/webhooks`, `topics`, `proposals`, `votes`, `delegations`,
`notifications`, `billing`, `slack`, `ai`, `scim/v2`. Comments, arguments,
endorsements and vetoes have their own modules. Background jobs are in `jobs/`.

## Frontend (`apps/web/src`)
Pages in `pages/` (one `*.tsx` + `*.module.css` each): landing, pricing, org
list/home, proposals list and detail, delegations and delegation network,
members, admin, settings, activity feed, decision record, public results,
embed, user profile, plus auth flows (join, invite, magic link, email verify).
Electric-backed collections are in `collections.ts`; REST calls in `api.ts`.

## Testing
- E2E: Playwright, specs in `e2e/tests`, shared fixtures in `e2e/fixtures.ts`.
  `npm run test:e2e` starts its own API (`NODE_ENV=test`), Vite and Caddy, but
  requires Postgres, Electric and Redis already up. `e2e/global-setup.ts` fails
  fast if the API on :3001 isn't in test mode, so stop a dev API first, or use
  `npx playwright test --config=playwright.config.test.ts` to run alongside it
  (test API on :3101, Caddy on :5274; it sets its own `PLAYWRIGHT_API_*` vars).
- In cloud sessions don't run `playwright install`: the preinstalled Chromium
  doesn't match this Playwright version, so set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` (the hook does).
- The full suite (~450 tests) takes a while; run single specs while iterating.
- Load tests: `load-tests/` (see its README).

## Deployment
- `Dockerfile` (targets `api` and `web`) and `deploy/` (production compose with
  Caddy auto-TLS, `.env.example`, README covering releases, managed Postgres,
  backups and monitoring). `GET /api/health` is the readiness probe.
- Type-check/build: `npm run build` (there is no linter or unit-test runner).
- CI (`.github/workflows/ci.yml`): `npm run build`, production Docker image
  builds, then the Playwright suite against the docker compose stack. Dependabot runs from the repo root
  (`.github/dependabot.yml`) so the shared `package-lock.json` stays in sync.
