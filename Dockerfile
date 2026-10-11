# Production images. Build from the repo root:
#   docker build --target api -t ripple-api .
#   docker build --target web -t ripple-web .
# deploy/docker-compose.prod.yml builds and wires both.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps ./apps
RUN npm run build

# --- API: compiled NestJS app with production dependencies only.
FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace=@stack-start/api --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 3001
# Migrations run automatically on boot (TypeORM migrationsRun). Run a single API
# replica during a release, or run `node dist/db/run-migrations.js` first.
CMD ["node", "dist/main.js"]

# --- Web: static SPA build served by Caddy, which also proxies /api.
FROM caddy:2.10-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
