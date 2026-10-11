# Ripple Project - Agent Context

Ripple is a liquid-democracy voting platform for organisations: orgs, topics,
proposals, votes (incl. delegation, blind/anonymous, quadratic, conviction),
comments, and admin/billing features. See `ROADMAP.md` for planned and
completed features and `CHANGELOG.md` for release history.

## Running services
- Do not assume anything is running. Check first (e.g. `curl -s localhost:3001/api/users`,
  `pg_isready -h localhost`) before starting or relying on a service.
- Local dev: `npm run db:up` (docker compose: postgres, electric, redis), then
  `npm run dev` (Caddy + API + web). If the user says a dev server is already
  running, don't start another.
- Cloud/remote sessions (claude.ai/code): the container starts fresh, so expect
  nothing to be running and `node_modules` to be missing (`npm ci` first).
  The Docker daemon has been unavailable and Caddy not installed there, so the
  compose stack (including ElectricSQL) and the HTTPS proxy on :5174 may not be
  startable. Native `postgres` 16 and `redis-server` binaries are present.
  `npm run build` (type-check + build) needs only `node_modules`.

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
  `/api/*` -> API :3001, `/electric/*` -> Electric :3000, everything else -> Vite :5173.

## Ports
| Service | Port |
|---|---|
| Caddy (app entry point) | 5174 (HTTPS, `tls internal`) |
| Vite | 5173 |
| API | 3001 (`API_PORT`), all routes under `/api` |
| ElectricSQL | 3000 |
| Postgres / replica (optional `replica` profile) | 5432 / 5433 |
| Redis | 6379 |
| Parallel test instance (`playwright.config.test.ts`) | Caddy 5274 -> API 3101 |

## Database
- Migrations live in `apps/api/src/db/migrations` (numbered `NNN-name.ts`) and
  run automatically on API boot (`migrationsRun: true`, `synchronize: false`);
  `npm run db:migrate` runs them manually. Add a new numbered migration for
  every schema change; never rely on synchronize.
- Tables published to Electric must be added to the publication (see
  `004-electric-publication.ts` and `docker/postgres-init.sql`).
- Seed data: `npm run seed --workspace=apps/api`.
- Entities are colocated with their modules (`*.entity.ts`); main tables include
  users, credentials, organisations, memberships, org_invites, topics, proposals
  (+ options, versions, links, reactions, signatures, boosts), votes,
  delegations, comments, comment_reactions, arguments, endorsements, vetoes,
  predictions, notifications, audit_log, api_keys, webhook_endpoints, magic_links.

## Environment
- `.env` is **not** loaded automatically (no dotenv); the API falls back to
  hard-coded local defaults, e.g. `DATABASE_URL=postgresql://postgres:password@localhost:5432/ripple`,
  `REDIS_URL=redis://localhost:6379`, `RP_ID=localhost`. Export variables in
  the shell to override.
- Optional integration keys (Resend, Stripe, Slack, Anthropic, etc.) are listed in
  `ROADMAP.md`; features degrade or are disabled without them.

## API modules (`apps/api/src`)
Controllers (prefix `/api`): `auth`, `users`, `orgs`, `orgs/:slug/api-keys`,
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
  `npx playwright test --config=playwright.config.test.ts` to run alongside it.
- In cloud sessions Chromium is preinstalled; don't run `playwright install`.
- Load tests: `load-tests/` (see its README).
- CI (`.github/workflows/ci.yml`): `npm run build`, then the Playwright suite
  against the docker compose stack.
