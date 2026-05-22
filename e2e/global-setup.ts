// Fails fast if the API is not running in test mode (NODE_ENV=test).
// This prevents the test suite from silently passing fixture calls against a
// dev API where /api/auth/test-reset and /api/auth/test-setup are forbidden.
export default async function globalSetup() {
  const probeUrl = process.env.PLAYWRIGHT_API_PROBE
    ?? 'http://localhost:3001/api/auth/test-reset';
  const res = await fetch(probeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  }).catch(() => null);

  if (!res || res.status === 403) {
    throw new Error(
      '\n\nAPI is not running in test mode.\n' +
      'Stop your dev API and let Playwright start it, or run:\n' +
      '  NODE_ENV=test npm run dev --workspace=apps/api\n',
    );
  }
}
