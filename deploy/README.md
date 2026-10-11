# Deploying Ripple

`deploy/docker-compose.prod.yml` runs the whole stack on one host: Postgres,
Redis, Electric, the API, and Caddy serving the built web app with automatic
HTTPS. It suits a first production deployment (one VM, tens of orgs). For more
scale or less operations work, move Postgres and Redis to managed services and
keep the same images.

## First deploy

1. A Linux VM with Docker, ports 80 and 443 open, and a DNS record for your
   domain pointing at it.
2. Configure:
   ```sh
   cp deploy/.env.example deploy/.env
   # fill in every value; generate secrets with: openssl rand -base64 48
   ```
3. Start:
   ```sh
   docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
   ```
4. Check: `curl https://$DOMAIN/api/health` returns `{"status":"ok"}`.
5. Stripe: add a webhook endpoint `https://$DOMAIN/api/billing/webhook` and put
   its signing secret in `STRIPE_WEBHOOK_SECRET`.
6. Email: verify the sending domain in Resend and publish its SPF, DKIM and
   DMARC records, or magic links will land in spam.

## Releases

```sh
git pull
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build
```

The API runs pending migrations when it boots, so run one API replica during a
release. Migrations must stay backwards compatible with the running version
while it is replaced.

## Configuration rules

- With `NODE_ENV=production` the API refuses to start if `SESSION_SECRET`,
  `ELECTRIC_SECRET`, `RECEIPT_SECRET`, `VOTE_EMAIL_SECRET`, `ORIGIN`, `RP_ID`
  or `APP_URL` is missing, or still set to a development default.
- `RP_ID` is the WebAuthn relying party (your bare domain). Changing it later
  invalidates every registered passkey.
- Electric is never exposed publicly; browsers reach it only through the API's
  authorising proxy at `/api/electric`.

## Managed Postgres

Electric needs logical replication: `wal_level=logical` and a role with the
`REPLICATION` attribute (on RDS: `rds.logical_replication=1`; most managed
providers have an equivalent switch). Create the publication once, as in
`docker/postgres-init.sql`; migrations add tables to it.

## Backups

Decision records are the product, so test restores, not just backups.

- Managed Postgres: enable point-in-time recovery and keep at least 14 days.
- This compose file: schedule a dump off the host, for example nightly:
  ```sh
  docker compose -f deploy/docker-compose.prod.yml exec -T postgres \
    pg_dump -U ripple -Fc ripple > ripple-$(date +%F).dump
  ```
  and copy it to object storage. Restore with `pg_restore -d ripple`.

## Monitoring

- Uptime: alert on `GET /api/health` (it returns 503 when the database is unreachable).
- Logs: `docker compose -f deploy/docker-compose.prod.yml logs -f api`.
- Error tracking is not built in yet; add Sentry (or similar) before taking on
  customers you can't afford to find bugs for.
