import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext } from '@playwright/test';

/**
 * Navigation, end to end: from the front door to a page's content, by
 * clicking.
 *
 * **Why every step is a click.** The defect this suite guards is that
 * nothing told a client which workspaces exist for it, so the tree could
 * only be reached by someone who already knew an id. A test that called
 * `page.goto('/workspaces/<id>/tree')` would therefore pass with the
 * entire navigation deleted — it would be exercising the tree screen, not
 * the way there. Exactly one address is typed in the happy path below, and
 * it is `/`; everything after it is a link the product had to render.
 *
 * Sessions are minted directly in the seed rather than driven through the
 * sign-in UI, as in e2e/read.spec.ts: this suite exercises navigation, not
 * authentication.
 */

interface Fixtures {
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
}

const fixtures: Fixtures = JSON.parse(readFileSync(new URL('.auth-fixtures.json', import.meta.url), 'utf8'));

// Serial, for the same reason e2e/read.spec.ts is: these tests walk
// on-demand-compiled dev-server routes, and two simultaneous first
// compiles of the same route are measurably slower than one warm pass.
// The raised timeout is for the same reason: the happy path below crosses
// three routes, each compiled on first visit, while the rest of the suite
// is competing for the same four cores.
test.describe.configure({ mode: 'serial', timeout: 120_000 });

async function signInAs(context: BrowserContext, token: string): Promise<void> {
  await context.addCookies([
    { name: 'session', value: token, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
}

test('a signed-in reader gets from the front door to a page by clicking, never by typing a URL', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  // The one and only address this test types.
  await page.goto('/');

  // `/` is the way in: it resolves to the workspace list rather than a
  // screen of its own.
  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/workspaces$/);

  // Click 1 — the list row. If this link is deleted, the test stops here.
  await page.getByRole('link', { name: /E2E Workspace/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Navigation tree' })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+\/tree$/);

  // Click 2 — the tree row, which is what a workspace list is for.
  await page.getByRole('treeitem', { name: /E2E Read Page/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'E2E Read Page' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText('Read mode serves this exact content, cached, without reparsing.')).toBeVisible();
});

test('a signed-in visitor who can read no workspace gets a coherent state, not an error and not a leak', async ({ page, context }) => {
  await signInAs(context, fixtures.outsiderSessionToken);

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'No workspaces you can open' })).toBeVisible({ timeout: 30000 });
  // Reading nothing is a state, not a failure: nothing on this screen is
  // announced as an alert and nothing offers a retry.
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
  // The workspace this visitor may not read is absent, not marked.
  await expect(page.getByText('E2E Workspace')).toHaveCount(0);
});

test('a signed-out visitor reaches sign-in from the front door, by clicking', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in to see your workspaces' })).toBeVisible({ timeout: 30000 });

  await page.getByRole('link', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: /sign in/i })).toBeVisible();
});

test('/workspaces/ with no id lands on the list rather than the framework 404', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  // Typed on purpose: this address is the subject of the test. It is what
  // a user is left holding after deleting the id off a tree URL, and it
  // previously matched no route at all.
  await page.goto('/workspaces/');

  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('link', { name: /E2E Workspace/ })).toBeVisible({ timeout: 30000 });
});
