import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { MAILPIT_HTTP_URL } from './ports';
import { membersUrl } from '../apps/web/app/utils/routes';

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

/** Serial, with the frame's own budget (e2e/frame.spec.ts): every test here signs in through the real form and the dev server compiles each route on its first visit. */
test.describe.configure({ mode: 'serial', timeout: 120_000 });

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
/** The slug the server derives from `WORKSPACE_NAME` — asserted below, right where the form fills it in. */
const WORKSPACE_SLUG = 'founder-handbook';
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
  // The breadcrumb names the workspace now — the screen's own heading is a
  // bare "Members" once it stands inside the frame (§4.4), the same
  // contract every other screen in the frame keeps. Scoped to the
  // breadcrumb specifically: the sidebar's switcher names the workspace
  // too, and an unscoped query would match both.
  await expect(page.getByRole('navigation', { name: 'Where you are' }).getByText(WORKSPACE_NAME)).toBeVisible();
  workspaceUrl = page.url();
  expect(workspaceUrl).toMatch(new RegExp(`${membersUrl(WORKSPACE_SLUG)}$`));

  // The screen the creation handed off to: invite a colleague from it and
  // see the invitation pending — the same session, no address typed. The
  // form is a dialog behind the screen's one primary action (owner
  // review, 2026-09-16); the fields inside are the reviewed ones.
  await expect(page.getByText(/no pending invitations/i)).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await shotM(page, 'members-1280-light');
  const inviteButton = page.getByRole('button', { name: /invite someone/i });
  await inviteButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /invite someone/i })).toBeVisible();
  // Focus is trapped in the dialog: Tab from its last control wraps to its first.
  expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), 'focus moved into the dialog').toBe(true);
  await dialog.getByLabel('Email').fill(fixtures.colleagueEmail);
  await dialog.getByRole('radio', { name: /write/i }).click();
  await shotM(page, 'invite-1280-light');
  await dialog.getByRole('button', { name: /send invitation/i }).click();

  // Sent: the dialog closes, focus comes back to the button that opened
  // it, and the confirmation is announced from the screen.
  await expect(dialog).toBeHidden();
  await expect(inviteButton).toBeFocused();
  // Two surfaces, on purpose (owner decision, 2026-09-23): the toast a
  // person reads, and the screen's always-present live region, which is
  // the half §5 relies on. Both name the address, because "Invitation
  // sent." on a screen that invites people all day says nothing about
  // which one.
  await expect(page.getByRole('status').filter({ hasText: /invitation sent/i }).first()).toContainText(fixtures.colleagueEmail);
  await expect(page.getByRole('status').filter({ hasText: /invitation sent/i })).toHaveCount(2);
  const pending = page.getByRole('heading', { level: 2, name: /pending invitations/i }).locator('..');
  await expect(pending).toContainText(fixtures.colleagueEmail);
  await expect(pending).toContainText(/write/i);
});

/**
 * Closing the invite dialog with an address typed asks first — inside the
 * dialog, in its footer, not a second dialog and not `window.confirm`.
 * Escape with the field empty closes at once. Both are the real key in a
 * real browser: Reka's `DialogContent` handles Escape, and a unit test
 * can only ask the component to close.
 */
test('Escape closes an untouched invite dialog; with an address typed it asks, and Discard clears it', async ({ page }) => {
  await signIn(page, fixtures.founderEmail);
  await goto(page, new URL(workspaceUrl).pathname);

  const inviteButton = page.getByRole('button', { name: /invite someone/i });
  await inviteButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(inviteButton).toBeFocused();

  await inviteButton.click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Email').fill('draft@example.com');
  await page.keyboard.press('Escape');
  await expect(dialog, 'an address typed: Escape does not close it').toBeVisible();
  await expect(dialog.getByText(/discard this invitation\?/i)).toBeVisible();
  await expect(dialog.getByRole('button', { name: /keep editing/i })).toBeFocused();
  await expect(dialog.getByRole('button', { name: /send invitation/i })).toHaveCount(0);

  await dialog.getByRole('button', { name: /keep editing/i }).click();
  await expect(dialog.getByLabel('Email')).toHaveValue('draft@example.com');
  await expect(dialog.getByRole('button', { name: /send invitation/i })).toBeVisible();

  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: /^discard$/i }).click();
  await expect(dialog).toBeHidden();
  await expect(inviteButton).toBeFocused();

  await inviteButton.click();
  await expect(dialog.getByLabel('Email')).toHaveValue('');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

/**
 * docs/UI-CHECKLIST.md §6: verified at 320px, by measurement rather than a
 * screenshot. Runs after the invite above (so a pending invitation is on
 * the screen) and before the colleague accepts it (so it is still
 * pending, not yet promoted to a member row). The screenshot is the
 * owner's review material (`frame3-members-*.png`).
 *
 * `document.documentElement` never scrolls inside the workspace frame:
 * `UDashboardPanel`'s generated body carries `overflow-y-auto`
 * (`apps/web/.nuxt/ui/dashboard-panel.ts`), and per the CSS spec a
 * non-`visible` `overflow-y` on an element whose `overflow-x` is
 * `visible` computes that axis to `auto` too — so *that* div, the
 * `[data-slot="body"]` ancestor of `#content-main` (AppShell's own
 * `<main>`), is the real horizontal scroll container an overflowing pane
 * clips into, invisibly to `document.documentElement.scrollWidth`. Both
 * are asserted, so a fix that only satisfies the outer one is still caught.
 */
const SHOTS = process.env.DEEPWIKI_FRAME_SHOTS ?? '';

async function shot3(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/frame3-members-${name}.png`, fullPage: false });
}

/** The invite dialog's review material (owner review, 2026-09-16). */
async function shotM(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  await page.screenshot({ path: `${SHOTS}/fb-manage-${name}.png`, fullPage: false });
}

function overflow(page: Page) {
  return page.evaluate(() => {
    const main = document.getElementById('content-main');
    const pane = main ? main.closest('[data-slot="body"]') : null;
    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      paneScrollWidth: pane ? pane.scrollWidth : null,
      paneClientWidth: pane ? pane.clientWidth : null,
    };
  });
}

test('the members screen fits at 320px with a pending invitation on it', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await signIn(page, fixtures.founderEmail);
  await goto(page, new URL(workspaceUrl).pathname);

  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
  await expect(page.getByText(fixtures.colleagueEmail)).toBeVisible();

  const box = await overflow(page);
  expect(box.scrollWidth, `document.documentElement.scrollWidth ${box.scrollWidth} vs innerWidth ${box.innerWidth}`).toBe(
    box.innerWidth,
  );
  expect(
    box.paneScrollWidth,
    `the content pane scrolls sideways: scrollWidth ${box.paneScrollWidth} vs clientWidth ${box.paneClientWidth}`,
  ).toBeLessThanOrEqual(box.paneClientWidth ?? 0);

  await shot3(page, '320-light');
  await shotM(page, 'members-320-light');

  // The dialog at 320: the same fields, inside the viewport, nothing
  // scrolling sideways — the pane check plus the dialog's own box.
  await page.getByRole('button', { name: /invite someone/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => Promise.allSettled(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  const dialogBox = (await dialog.boundingBox())!;
  expect(dialogBox.x, 'the dialog starts inside the viewport').toBeGreaterThanOrEqual(0);
  expect(dialogBox.x + dialogBox.width, 'the dialog ends inside the viewport').toBeLessThanOrEqual(320);
  const dialogScroll = await dialog.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(dialogScroll.scrollWidth, `the dialog scrolls sideways: ${JSON.stringify(dialogScroll)}`).toBeLessThanOrEqual(dialogScroll.clientWidth);
  await shotM(page, 'invite-320-light');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the invite dialog in the dark theme, for review', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addInitScript(() => localStorage.setItem('nuxt-color-mode', 'dark'));
  await signIn(page, fixtures.founderEmail);
  await goto(page, new URL(workspaceUrl).pathname);
  await expect(page.locator('html')).toHaveClass(/dark/);
  await shotM(page, 'members-1280-dark');
  await page.getByRole('button', { name: /invite someone/i }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate((el) => Promise.allSettled(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  await shotM(page, 'invite-1280-dark');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
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

  await page.goto(workspaceUrl.replace(/\/w\/[a-z0-9-]+\/members$/, '/w/never-minted-workspace/members'));
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
