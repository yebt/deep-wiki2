import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

/**
 * Sign-in, invitation-accept, and password-reset e2e (design.md — Phase
 * 17). Against a real, freshly seeded backend (e2e/global-setup.ts) — not
 * mocked. Assertions target accessible roles and names throughout, per
 * docs/UI-CHECKLIST.md §7 ("never CSS classes").
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly signinEmail: string;
  readonly signinInvitationToken: string;
  readonly keyboardEmail: string;
  readonly keyboardInvitationToken: string;
  readonly expiredInvitationToken: string;
  readonly resetEmail: string;
  readonly resetToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

const SIGNIN_PASSWORD = 'correct-horse-battery-staple';
const NEW_RESET_PASSWORD = 'brand-new-password-123';

/**
 * Nuxt renders every page server-side first, then hydrates it in the
 * browser; a click before hydration attaches its handler is a no-op, and
 * a field filled before hydration is silently emptied when `UAuthForm`
 * rebuilds its reactive state from the fields' `defaultValue`.
 *
 * Network idle alone does not close that window: the dev server holds an
 * open HMR socket and Vite serves the app graph in many small requests,
 * so idle can be reached with hydration still pending — which showed up
 * under parallel load as a filled invitation form submitting empty. Nuxt
 * exposes the authoritative signal (`nuxtApp.isHydrating`) on `window`,
 * so wait for that instead of approximating it.
 */
async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
}

test.describe.serial('invitation accept -> sign in (happy path)', () => {
  test('accepting a valid invitation creates the account and joins the workspace', async ({ page }) => {
    await goto(page, `/invite/accept?token=${fixtures.signinInvitationToken}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Join your workspace' })).toBeVisible();

    await page.getByLabel('Your name').fill('E2E Sign-in User');
    await page.getByLabel('Choose a password', { exact: true }).fill(SIGNIN_PASSWORD);
    await page.getByLabel('Confirm password').fill(SIGNIN_PASSWORD);
    await page.getByRole('button', { name: /join workspace/i }).click();

    await expect(page.getByRole('status')).toContainText(/joined the workspace/i);
  });

  test('signing in with the account just created succeeds', async ({ page }) => {
    await goto(page, '/login');

    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(fixtures.signinEmail);
    await page.getByLabel('Password', { exact: true }).fill(SIGNIN_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByRole('status')).toContainText(/signed in/i);
  });

  test('reusing the same invitation link a second time shows the already-used state, not the form', async ({ page }) => {
    // The API only learns a token is dead when acceptance is actually
    // attempted (there is no separate "check validity" endpoint), so this
    // screen shows the join form again until that attempt is made.
    await goto(page, `/invite/accept?token=${fixtures.signinInvitationToken}`);
    await page.getByLabel('Your name').fill('E2E Sign-in User');
    await page.getByLabel('Choose a password', { exact: true }).fill(SIGNIN_PASSWORD);
    await page.getByLabel('Confirm password').fill(SIGNIN_PASSWORD);
    await page.getByRole('button', { name: /join workspace/i }).click();

    await expect(page.getByText(/already been used/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /join workspace/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });
});

test('signing in with the wrong password shows a recoverable error via an announced alert', async ({ page }) => {
  await goto(page, '/login');

  await page.getByLabel('Email').fill('someone-who-may-or-may-not-exist@example.com');
  await page.getByLabel('Password', { exact: true }).fill('totally-wrong-password');
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page.getByRole('alert')).toContainText(/incorrect email or password/i);
  // Non-disclosure: the message never says whether the account exists.
  await expect(page.getByRole('alert')).not.toContainText(/no account|does not exist|not found/i);
});

test('signing in is fully keyboard-operable', async ({ page, request }) => {
  // Independent fixture account, accepted via a direct API call — this
  // test only exercises the sign-in screen's keyboard path, not
  // invitation acceptance, and must never race the serial sign-in flow
  // above for the same account across Playwright's worker processes.
  const accept = await request.post(`${fixtures.apiUrl}/invitations/accept`, {
    data: { token: fixtures.keyboardInvitationToken, password: SIGNIN_PASSWORD, displayName: 'Keyboard User' },
  });
  expect(accept.ok()).toBe(true);

  await goto(page, '/login');

  await page.getByLabel('Email').focus();
  await page.keyboard.type(fixtures.keyboardEmail);
  await page.keyboard.press('Tab');
  await page.keyboard.type(SIGNIN_PASSWORD);
  // Tab past the "show password" toggle button to reach the submit control.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page.getByRole('status')).toContainText(/signed in/i);
});

test.describe('invitation dead-link states', () => {
  test('a missing token shows its own invalid state, with no form', async ({ page }) => {
    await goto(page, '/invite/accept');

    await expect(page.getByText(/invitation link isn't valid/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /join workspace/i })).toHaveCount(0);
  });

  test('an expired invitation shows its own state, distinct from an invalid link', async ({ page }) => {
    await goto(page, `/invite/accept?token=${fixtures.expiredInvitationToken}`);
    await page.getByLabel('Your name').fill('Someone');
    await page.getByLabel('Choose a password', { exact: true }).fill('a-strong-password');
    await page.getByLabel('Confirm password').fill('a-strong-password');
    await page.getByRole('button', { name: /join workspace/i }).click();

    await expect(page.getByText(/invitation has expired/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /join workspace/i })).toHaveCount(0);
  });
});

test.describe('password reset', () => {
  test('requesting a reset shows the same generic confirmation for any address (non-disclosure)', async ({ page }) => {
    await goto(page, '/forgot-password');

    await expect(page.getByRole('heading', { level: 1, name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill('this-account-does-not-exist@example.com');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByRole('status')).toContainText(/if an account exists for that email/i);
  });

  test('confirming with a valid token sets a new password usable to sign in', async ({ page }) => {
    await goto(page, `/reset-password?token=${fixtures.resetToken}`);

    await expect(page.getByRole('heading', { level: 1, name: 'Set a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(NEW_RESET_PASSWORD);
    await page.getByLabel('Confirm new password').fill(NEW_RESET_PASSWORD);
    await page.getByRole('button', { name: /set new password/i }).click();

    await expect(page.getByRole('status')).toContainText(/password has been changed/i);

    await page.getByRole('link', { name: /continue to sign in/i }).click();
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();

    await page.getByLabel('Email').fill(fixtures.resetEmail);
    await page.getByLabel('Password', { exact: true }).fill(NEW_RESET_PASSWORD);
    await page.getByRole('button', { name: /^sign in$/i }).click();

    await expect(page.getByRole('status')).toContainText(/signed in/i);
  });

  test('confirming with an invalid token shows its own dead-link state, not a generic error', async ({ page }) => {
    await goto(page, '/reset-password?token=never-issued-token');
    await page.getByLabel('New password', { exact: true }).fill('some-new-password');
    await page.getByLabel('Confirm new password').fill('some-new-password');
    await page.getByRole('button', { name: /set new password/i }).click();

    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
  });

  test('a missing token shows the invalid-link state immediately, with no form', async ({ page }) => {
    await goto(page, '/reset-password');

    await expect(page.getByText(/password reset link isn't valid/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /set new password/i })).toHaveCount(0);
  });
});
