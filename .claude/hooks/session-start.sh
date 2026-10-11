#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: installs dependencies and
# brings up the backing services (Postgres, Electric, Redis) so the app, the
# build and the Playwright suite can run. Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

log() { echo "[session-start] $*" >&2; }

# --- npm dependencies. `npm ci` rather than `npm install`, which rewrites the
# lockfile under newer npm versions; skipped when the cached container already
# has node_modules matching the lockfile.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi

# --- Caddy (HTTPS entry point on :5174). GitHub release downloads are blocked
# by the cloud network proxy; caddyserver.com serves the same binary.
if ! command -v caddy >/dev/null 2>&1; then
  log "installing caddy"
  curl -fsSL -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
  chmod +x /usr/local/bin/caddy
fi

# --- Playwright: the preinstalled Chromium may not match this Playwright
# version, and browsers can't be downloaded here. The configs honour this var.
if [ -x /opt/pw-browsers/chromium ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium' >> "$CLAUDE_ENV_FILE"
fi

# --- Docker daemon is installed but not started in cloud containers.
if ! docker info >/dev/null 2>&1; then
  log "starting dockerd"
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for _ in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi

# --- Backing services and migrations. Best-effort: Docker Hub can rate-limit
# image pulls, and the dependencies above are still useful without services.
if docker info >/dev/null 2>&1; then
  if docker compose up -d --wait postgres electric redis; then
    npm run db:migrate || log "WARNING: migrations failed"
  else
    log "WARNING: docker compose failed (Docker Hub rate limit?). Retry with: npm run db:up"
  fi
else
  log "WARNING: dockerd did not start; see /tmp/dockerd.log"
fi
