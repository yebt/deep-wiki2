import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MAILPIT_HTTP_URL } from './ports';

/**
 * The front door: a fresh user with no workspace signs in, creates one by
 * clicking, invites a colleague from the members screen, and the colleague
 * accepts the mailed link and lands on the tree — against a real backend
 * and the real mail the API sends (e2e/global-setup.ts brings up Mailpit).
 *
 * Nothing on the happy path past `/login` is reached by typing a URL. The
 * one address that *is* typed there is the accept link, because that is
 * exactly how an invitee reaches it — out of their inbox — and here it is
 * read back out of the inbox the API delivered it to. A URL-driven walk of
 * these screens would pass with every affordance between them deleted.
 *
 * The denied case navigates by address, as e2e/diff.spec.ts does for the
 * same reason: a member without `manage` has no click path onto the
 * members screen, and the property under test is what happens when they
 * arrive there anyway.
 */

interface Fixtures {
  readonly founderEmail: string;
  readonly colleagueEmail: string;
  readonly onboardingPassword: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

test.describe.configure({ mode: 'serial' });

/** See e2e/auth.spec.ts: wait for hydration, not merely for the network. */
async function goto(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
}

async function signIn(page: Page, email: string): Promise<void> {
  await goto(page, '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixtures.onboardingPassword);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page.getByRole('status')).toContainText(/signed in/i);
  // The sign-in screen forwards to the workspace list on its own.
  await expect(page).toHaveURL(/\/workspaces$/);
  await page.waitForLoadState('networkidle');
}

interface MailpitMessage {
  readonly ID: string;
  readonly To: ReadonlyArray<{ Address: string }>;
}

/** The accept link the API mailed to `address`, read out of Mailpit. */
async function acceptLinkMailedTo(address: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const list = await fetch(`${MAILPIT_HTTP_URL}/api/v1/messages`);
    const { messages } = (await list.json()) as { messages: MailpitMessage[] };
    const message = messages.find((m) => m.To.some((to) => to.Address.toLowerCase() === address.toLowerCase()));
    if (message) {
      const detail = await fetch(`${MAILPIT_HTTP_URL}/api/v1/message/${message.ID}`);
      const { Text } = (await detail.json()) as { Text?: string };
      const link = Text?.match(/https?:\/\/\S+/)?.[0];
      if (link) return link;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`no invitation mail reached ${address} within 15s`);
}

const WORKSPACE_NAME = 'Founder Handbook';
let workspaceUrl = '';

test('a fresh user creates a workspace by clicking, is handed the members screen, and invites a colleague', async ({ page }) => {
  await signIn(page, fixtures.founderEmail);

  // Nothing to open yet — and the way to start one is on this screen.
  await expect(page.getByRole('heading', { level: 2, name: /no workspaces you can open/i })).toBeVisible();
  await page.getByRole('link', { name: /new workspace/i }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'New workspace' })).toBeVisible();
  await page.getByLabel('Name').fill(WORKSPACE_NAME);
  // The slug followed the name; it is what the server will accept.
  await expect(page.getByLabel('Slug')).toHaveValue('founder-handbook');
  await page.getByRole('button', { name: /create workspace/i }).click();

  const created = page.getByRole('status');
  await expect(created).toContainText(new RegExp(`Created ${WORKSPACE_NAME}`));
  await page.getByRole('link', { name: /invite your team/i }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  // Scoped to the screen: the sidebar's switcher names the workspace too.
  await expect(page.getByRole('main').getByText(WORKSPACE_NAME)).toBeVisible();
  workspaceUrl = page.url();
  expect(workspaceUrl).toMatch(/\/workspaces\/[0-9a-f-]{36}\/members$/);

  // The screen the creation handed off to: invite a colleague from it and
  // see the invitation pending — the same session, no address typed.
  await expect(page.getByText(/no pending invitations/i)).toBeVisible();
  await page.getByLabel('Email').fill(fixtures.colleagueEmail);
  await page.getByRole('radio', { name: /write/i }).click();
  await page.getByRole('button', { name: /send invitation/i }).click();

  await expect(page.getByRole('status').filter({ hasText: /invitation sent/i })).toContainText(fixtures.colleagueEmail);
  const pending = page.getByRole('heading', { level: 2, name: /pending invitations/i }).locator('..');
  await expect(pending).toContainText(fixtures.colleagueEmail);
  await expect(pending).toContainText(/write/i);
});

test('the colleague accepts the mailed link, signs in, and lands on the tree', async ({ page }) => {
  const link = await acceptLinkMailedTo(fixtures.colleagueEmail);
  await goto(page, new URL(link).pathname + new URL(link).search);

  await expect(page.getByRole('heading', { level: 1, name: 'Join your workspace' })).toBeVisible();
  // An existing account keeps its password; the form still asks, and the
  // values are ignored server-side for an existing user.
  await page.getByLabel('Your name').fill('E2E Colleague');
  await page.getByLabel('Choose a password', { exact: true }).fill(fixtures.onboardingPassword);
  await page.getByLabel('Confirm password').fill(fixtures.onboardingPassword);
  await page.getByRole('button', { name: /join workspace/i }).click();
  await expect(page.getByRole('status')).toContainText(/joined the workspace/i);
  await page.getByRole('link', { name: /continue to sign in/i }).click();

  await page.getByLabel('Email').fill(fixtures.colleagueEmail);
  await page.getByLabel('Password', { exact: true }).fill(fixtures.onboardingPassword);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).toHaveURL(/\/workspaces$/);

  await page.getByRole('link', { name: new RegExp(WORKSPACE_NAME) }).click();
  // The workspace's home, with its empty tree in the sidebar beside it.
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(WORKSPACE_NAME) })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: /nothing has happened here yet/i })).toBeVisible();
  await expect(page.getByText(/no shelves yet/i)).toBeVisible();
});

test('a member without manage cannot see the members screen, and cannot tell it from a missing workspace', async ({ page }) => {
  await signIn(page, fixtures.colleagueEmail);
  await page.goto(workspaceUrl);
  await page.waitForLoadState('networkidle');
  // Scoped to the screen: the sidebar's tree toolbar keeps its own live region.
  const denied = page.getByRole('main').getByRole('status');
  await expect(denied).toContainText(/does not exist, or you do not manage it/i);
  await expect(page.getByRole('form')).toHaveCount(0);

  await page.goto(workspaceUrl.replace(/[0-9a-f-]{36}\/members$/, '00000000-0000-4000-8000-000000000000/members'));
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('main').getByRole('status')).toContainText(/does not exist, or you do not manage it/i);
});

test('the founder at the plan limit is told the number, not shown a form', async ({ page }) => {
  await signIn(page, fixtures.founderEmail);
  await page.getByRole('link', { name: /new workspace/i }).click();
  await page.getByLabel('Name').fill('A Second Handbook');
  await page.getByRole('button', { name: /create workspace/i }).click();

  const refusal = page.getByRole('status');
  await expect(refusal).toContainText(/reached your plan's limit/i);
  await expect(refusal).toContainText(/allows 1 workspace/i);
  await expect(page.getByRole('button', { name: /create workspace/i })).toHaveCount(0);
});
