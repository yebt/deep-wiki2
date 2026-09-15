import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Navigation, end to end: from the front door to a page's content, by
 * clicking.
 *
 * **Why every step is a click.** The defect this suite guards is that
 * nothing told a client which workspaces exist for it, so the tree could
 * only be reached by someone who already knew an id. A test that called
 * `page.goto('/workspaces/<id>')` would therefore pass with the
 * entire navigation deleted — it would be exercising the tree screen, not
 * the way there. Exactly one address is typed in the happy path below, and
 * it is `/`; everything after it is a link the product had to render.
 *
 * Sessions are minted directly in the seed rather than driven through the
 * sign-in UI, as in e2e/read.spec.ts: this suite exercises navigation, not
 * authentication.
 */

interface Fixtures {
  readonly apiUrl: string;
  readonly bookHistoryShelfTitle: string;
  readonly bookHistoryBookTitle: string;
  readonly workspaceId: string;
  readonly readerSessionToken: string;
  readonly outsiderSessionToken: string;
  readonly superRootEmail: string;
  readonly onboardingPassword: string;
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

/**
 * A field filled — or a button clicked — before hydration lands on
 * `UAuthForm`'s own documented gotcha: until Vue's handlers attach, its
 * submit control is not a submit button at all, so the click falls
 * through to the browser's native form submission and reloads the page
 * with the fields cleared, which looks exactly like a rejected password.
 * `e2e/auth.spec.ts` and `e2e/onboarding.spec.ts` both wait for Nuxt's own
 * `isHydrating` signal before touching a form for this exact reason —
 * network-idle alone is not enough, since the dev server's HMR socket and
 * Vite's many small requests can reach idle with hydration still pending.
 */
async function gotoAndWaitForHydration(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => {
    const nuxt = (globalThis as { useNuxtApp?: () => { isHydrating?: boolean } }).useNuxtApp;
    return typeof nuxt === 'function' && nuxt().isHydrating === false;
  });
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

  // The workspace's home: its name is the screen's heading, and its tree
  // stands in the sidebar beside it rather than being a screen of its own.
  await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+$/);

  // Click 2 — the tree row in the sidebar, which is what the sidebar is for.
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

test('a signed-in member reaches the workspace members screen by clicking the tree’s Members link, never by typing the URL', async ({
  page,
  context,
}) => {
  await signInAs(context, fixtures.readerSessionToken);

  // The one and only address this test types.
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeVisible({ timeout: 30000 });

  // Click 1 — the list row, same as the happy-path test above.
  await page.getByRole('link', { name: /E2E Workspace/ }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'E2E Workspace' })).toBeVisible({ timeout: 30000 });

  // Click 2 — the Members door in the sidebar's footer. It renders for
  // every caller who can open this workspace at all (docs/TODO.md — no
  // `manage` signal reaches the client today), so a plain workspace member
  // is enough to prove the click actually goes somewhere; the screen's own
  // "Nothing to manage here" state is what would gate a caller without
  // `manage`, not this link's visibility.
  await page.getByRole('link', { name: 'Members' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]+\/members$/);
});

/*
 * The seeded operator (`superRootEmail`) carries no grant on any
 * workspace in this fixture set — `is_super_root` does not bypass `can()`
 * (design.md D11), and nothing in `e2e/seed.bun.ts` grants this user
 * workspace access. So this flow signs in through the real form instead
 * of a minted cookie (the one `page.goto` is to `/login`, which the task
 * brief names as the allowed exception), lands on the same "No workspaces
 * you can open" state an outsider gets, and reaches `/admin/registration`
 * from the chrome — which renders regardless of what the content pane
 * shows, because it lives in `AppShell`, not on any one screen.
 */
test('the seeded operator reaches registration settings by clicking the chrome entry, never by typing the URL', async ({ page }) => {
  await gotoAndWaitForHydration(page, '/login');

  await page.getByLabel('Email').fill(fixtures.superRootEmail);
  await page.getByLabel('Password', { exact: true }).fill(fixtures.onboardingPassword);
  await page.getByRole('button', { name: /^sign in$/i }).click();

  await expect(page.getByRole('heading', { name: 'No workspaces you can open' })).toBeVisible({ timeout: 30000 });

  // The chrome entry this task adds beside the theme toggle. It renders
  // for every caller — no `is_super_root` signal reaches the client today
  // — so `/admin/registration`'s own "This is the instance operator's"
  // state is what would gate a non-operator, not this link's visibility.
  await page.getByRole('link', { name: 'Registration settings' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Registration' })).toBeVisible({ timeout: 30000 });
  await expect(page).toHaveURL(/\/admin\/registration$/);
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

/**
 * §3: the skeleton occupies the loaded box — measured, not assumed. Audit
 * defect 4 (2026-09-14): the workspace list's skeleton rows sat 24px up
 * and to the left of the rows that replaced them, because the loaded list
 * lives inside a filled card under an action row and the skeleton was
 * three bare bars at the top of the column. happy-dom has no layout, so
 * this file is the owner: hold the response, measure, release, measure.
 */
test('the workspace list skeleton occupies the box the loaded rows take', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${fixtures.apiUrl}/workspaces`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await held;
    await route.continue();
  });

  await page.goto('/workspaces');
  const skeleton = page.getByTestId('workspace-list-skeleton');
  await expect(skeleton).toBeVisible({ timeout: 30000 });
  const skeletonRow = (await skeleton.locator('> *').first().boundingBox())!;

  release();
  const row = page.getByRole('link', { name: /E2E Workspace/ });
  await expect(row).toBeVisible({ timeout: 30000 });
  const loadedRow = (await row.boundingBox())!;

  expect(Math.abs(skeletonRow.x - loadedRow.x), `row left: skeleton ${skeletonRow.x}, loaded ${loadedRow.x}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonRow.y - loadedRow.y), `row top: skeleton ${skeletonRow.y}, loaded ${loadedRow.y}`).toBeLessThanOrEqual(1);
  expect(Math.abs(skeletonRow.height - loadedRow.height), `row height: skeleton ${skeletonRow.height}, loaded ${loadedRow.height}`).toBeLessThanOrEqual(1);
});

/**
 * The tree's toolbar and its rows, after the 2026-09-14 audit: toolbar
 * controls are §7.2's 32px (they measured 40); the toolbar acts on a row
 * the user can see — nothing is selected until they pick one, and the
 * picked row carries the fill (docs/DESIGN-SYSTEM.md §5.2); and a shelf,
 * book or chapter row folds on Enter and on click instead of doing
 * nothing while claiming to be expanded. The tree lives in the sidebar
 * now; the contract is the same.
 */
test('the tree toolbar is 32px, acts only on a row the user picked, and container rows fold on Enter', async ({ page, context }) => {
  await signInAs(context, fixtures.readerSessionToken);

  await page.goto(`/workspaces/${fixtures.workspaceId}`);
  const shelf = page.getByRole('treeitem', { name: new RegExp(fixtures.bookHistoryShelfTitle) });
  await expect(shelf).toBeVisible({ timeout: 30000 });

  // §7.2: a toolbar control is 32px, not the content-area 40px.
  const create = page.getByRole('button', { name: 'New…' });
  expect((await create.boundingBox())!.height, 'New… height').toBeLessThanOrEqual(33);
  expect((await create.boundingBox())!.height, 'New… height').toBeGreaterThanOrEqual(31);

  // Nothing is selected yet, and the toolbar says so — reachable by
  // keyboard, since the control is aria-disabled rather than removed.
  const rename = page.getByRole('button', { name: /^Rename…$/ });
  await expect(rename).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0);

  // Pick the shelf. It is now visibly selected — a container fill that
  // differs from an unselected row — and the toolbar names it.
  const shelfRow = shelf.locator('[draggable="true"]').first();
  const book = page.getByRole('treeitem', { name: new RegExp(fixtures.bookHistoryBookTitle) });
  const bookRow = book.locator('[draggable="true"]').first();
  const unselectedFill = await bookRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  await shelfRow.click();
  await expect(shelf).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: `Rename “${fixtures.bookHistoryShelfTitle}”…` })).toBeVisible();
  const selectedFill = await shelfRow.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(selectedFill).not.toBe(unselectedFill);

  // The click also folded the shelf: its book is gone from the tree and
  // the shelf says so. Enter unfolds it again.
  await expect(shelf).toHaveAttribute('aria-expanded', 'false');
  await expect(book).toHaveCount(0);
  await shelf.press('Enter');
  await expect(shelf).toHaveAttribute('aria-expanded', 'true');
  await expect(book).toBeVisible();
  await shelf.press('Enter');
  await expect(book).toHaveCount(0);
});
