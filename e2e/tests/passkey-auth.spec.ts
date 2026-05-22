import { test, expect } from '../fixtures';
import type { CDPSession } from '@playwright/test';

// Sets up a virtual FIDO2 authenticator via Chrome DevTools Protocol.
// This is the pre-1.60 CDP equivalent of context.addVirtualAuthenticator().
async function addVirtualAuthenticator(cdp: CDPSession): Promise<void> {
  await cdp.send('WebAuthn.enable', { enableUI: false });
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test.describe('passkey authentication', () => {
  test('can register a new account with a passkey', async ({ page, context }) => {
    await page.goto('/');
    const cdp = await context.newCDPSession(page);
    await addVirtualAuthenticator(cdp);

    // Open the auth panel from the landing page
    await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
    // Switch to register mode
    await page.getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Passkey User');
    await page.getByLabel('Email').fill('passkey@example.com');
    await page.getByRole('button', { name: 'Create passkey' }).click();

    // Successful registration logs the user in and shows their name in the shell
    await expect(page.getByText('Passkey User')).toBeVisible({ timeout: 15000 });
  });

  test('can sign in with a passkey after registering', async ({ page, context }) => {
    await page.goto('/');
    const cdp = await context.newCDPSession(page);
    await addVirtualAuthenticator(cdp);

    // Register
    await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Passkey User');
    await page.getByLabel('Email').fill('passkey@example.com');
    await page.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.getByText('Passkey User')).toBeVisible({ timeout: 15000 });

    // Sign out
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Re-open auth panel from landing page
    await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign in with passkey' })).toBeVisible();

    // Sign in with the stored passkey (virtual authenticator still holds the credential)
    await page.getByRole('button', { name: 'Sign in with passkey' }).click();
    await expect(page.getByText('Passkey User')).toBeVisible({ timeout: 15000 });
  });

  test('shows error when passkey creation is cancelled', async ({ page }) => {
    // No virtual authenticator — WebAuthn fails with NotSupportedError
    await page.goto('/');
    // Open the auth panel from the landing page
    await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
    // Switch to register mode
    await page.getByRole('button', { name: 'Register' }).click();
    await page.getByLabel('Name').fill('Passkey User');
    await page.getByLabel('Email').fill('passkey@example.com');
    await page.getByRole('button', { name: 'Create passkey' }).click();

    // App catches the error and displays it in red (no authenticator → "No available authenticator..." from the browser)
    await expect(page.getByTestId('auth-error')).toBeVisible({ timeout: 10000 });
  });
});
