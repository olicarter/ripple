// Development fallbacks used elsewhere in the code. Fine locally, fatal in production:
// anyone who has read this repository could forge sessions, receipts or vote links.
const DEV_DEFAULTS: Record<string, string> = {
  SESSION_SECRET: 'ripple-session-secret',
  ELECTRIC_SECRET: 'ripple-dev-electric-secret',
  RECEIPT_SECRET: 'ripple-receipt-insecure',
  VOTE_EMAIL_SECRET: 'ripple-insecure',
};

const REQUIRED_SECRETS = Object.keys(DEV_DEFAULTS);
const REQUIRED_SETTINGS = ['DATABASE_URL', 'ORIGIN', 'RP_ID', 'APP_URL'];

/** Problems that make the environment unsafe to run in production (empty if fine). */
export function productionConfigProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const key of REQUIRED_SECRETS) {
    const value = env[key];
    if (!value) problems.push(`${key} is not set`);
    else if (value === DEV_DEFAULTS[key]) problems.push(`${key} is still the development default`);
    else if (value.length < 32) problems.push(`${key} must be at least 32 characters`);
  }
  for (const key of REQUIRED_SETTINGS) {
    if (!env[key]) problems.push(`${key} is not set`);
  }
  if (env.RP_ID === 'localhost') problems.push('RP_ID is still localhost');
  return problems;
}

export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  const problems = productionConfigProblems(env);
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  }
}
