import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import MembersPage from './members.vue';

const { useWorkspaceMembersMock, useRouteMock, navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(async () => {}),
  useWorkspaceMembersMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' } })),
}));

mockNuxtImport('useWorkspaceMembers', () => useWorkspaceMembersMock);
mockNuxtImport('useRoute', () => useRouteMock);
mockNuxtImport('navigateTo', () => navigateToMock);

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(MembersPage) }),
});

/** The modal teleports into `document.body`, so between tests the body is emptied of what a previous mount left there. */
afterEach(() => {
  document.body.innerHTML = '';
});

/** The invite dialog — `UModal` content lives under `document.body`, outside the wrapper. */
function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

/** Presses the screen's primary action and waits for the dialog to mount. */
async function openInvite(component: Awaited<ReturnType<typeof mountSuspended<typeof PageInApp>>>): Promise<HTMLElement> {
  const button = component.findAll('button').find((b) => /invite someone/i.test(b.text()));
  expect(button, 'the "Invite someone" button in the screen\'s header').toBeDefined();
  await button!.trigger('click');
  await nextTick();
  await flushPromises();
  const opened = dialog();
  expect(opened, 'the invite dialog is open').not.toBeNull();
  return opened!;
}

function emailInputIn(root: HTMLElement): HTMLInputElement {
  const label = [...root.querySelectorAll('label')].find((l) => /^email/i.test(l.textContent ?? ''));
  expect(label, 'a label whose text is "Email"').toBeDefined();
  return root.querySelector<HTMLInputElement>(`#${CSS.escape(label!.getAttribute('for')!)}`)!;
}

async function setValue(input: HTMLInputElement, value: string): Promise<void> {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}

const listing = {
  workspace: { id: 'ws-1', name: 'Acme Handbook', slug: 'acme-handbook' },
  rootNodeId: 'root-1',
  members: [
    { id: 'u-1', displayName: 'Ada Lovelace', email: 'ada@example.com' },
    { id: 'u-2', displayName: 'Grace Hopper', email: 'grace@example.com' },
  ],
  invitations: [
    {
      id: 'i-1',
      email: 'pending@example.com',
      startingGrants: [{ resourceId: 'root-1', action: 'write' }],
      createdAt: '2026-09-14T10:00:00.000Z',
      expiresAt: '2026-09-21T10:00:00.000Z',
    },
  ],
  truncated: false,
};

function mockMembers(
  overrides: { status?: string; message?: string; listing?: unknown; inviteStatus?: string; inviteMessage?: string } = {},
) {
  const load = vi.fn(async () => {});
  const invite = vi.fn(async () => {});
  useWorkspaceMembersMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    listing: ref(overrides.listing ?? null),
    inviteStatus: ref(overrides.inviteStatus ?? 'idle'),
    inviteMessage: ref(overrides.inviteMessage ?? ''),
    load,
    invite,
  });
  return { load, invite };
}

describe('workspace members screen', () => {
  test('renders one bare h1 and the shell landmarks — the breadcrumb, not an eyebrow, names the workspace now', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Members');
    // The roster's own heading does not repeat the h1's word (§4.4).
    expect(component.findAll('h2').map((h) => h.text())).toEqual(['Current members', 'Pending invitations']);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    // Inside the workspace frame there is no footer: the doors are the sidebar's.
    expect(component.find('footer').exists()).toBe(false);
  });

  test('renders a skeleton while it loads, and no primary action yet', async () => {
    mockMembers({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="members-skeleton"]').exists()).toBe(true);
    expect(component.find('form').exists()).toBe(false);
    expect(component.findAll('button').some((b) => /invite someone/i.test(b.text()))).toBe(false);
  });

  /*
   * The invite form used to be a permanent column beside the roster — a
   * screen saturated with a form most visits never fill (owner review,
   * 2026-09-16). It is a dialog now, opened by the screen's one primary
   * action in the contextual bar, and the two lists are the screen's
   * single column: `measure`, the same 72ch the tree takes, because a
   * roster row is one line read left to right (docs/DESIGN-SYSTEM.md
   * §2.4). Every field, description and the access choice inside the
   * dialog are what was reviewed; only where they stand changed.
   */
  test('the invite form is not on the screen until "Invite someone" opens it as a dialog with a focus trap', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('form').exists()).toBe(false);
    expect(dialog()).toBeNull();
    // The lists stand on the reading measure, not a two-column grid.
    expect(component.get('main').classes()).toContain('max-w-measure');
    expect(component.find('.grid').exists()).toBe(false);

    const opened = await openInvite(component);
    // `role="dialog"` from Reka's `DialogContent`, which owns the focus
    // trap and the focus return (docs/DESIGN-SYSTEM.md §9.6); the trap
    // itself is a browser measurement, e2e/onboarding.spec.ts's.
    expect(opened.getAttribute('role')).toBe('dialog');
    expect(opened.textContent).toMatch(/invite someone/i);
    expect(opened.textContent).toMatch(/They get an email with a link that expires/);
    expect(opened.querySelector('form')).not.toBeNull();
    expect(opened.querySelectorAll('[role="radio"]').length).toBeGreaterThanOrEqual(4);
    expect([...opened.querySelectorAll('button')].some((b) => /send invitation/i.test(b.textContent ?? ''))).toBe(true);
  });

  test('Escape with nothing typed closes the dialog; with an address typed it stays open and asks, and Discard closes it and clears the address', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    await openInvite(component);
    const modal = component.findComponent({ name: 'UModal' });
    // What Escape, the close control and a click outside all do: ask the dialog to close.
    modal.vm.$emit('update:open', false);
    await nextTick();
    await flushPromises();
    expect(dialog(), 'nothing typed: the dialog closes').toBeNull();

    const reopened = await openInvite(component);
    await setValue(emailInputIn(reopened), 'someone@example.com');
    modal.vm.$emit('update:open', false);
    await nextTick();
    await flushPromises();
    const still = dialog();
    expect(still, 'an address typed: the dialog stays open').not.toBeNull();
    expect(still!.textContent).toMatch(/discard this invitation\?/i);
    const keep = [...still!.querySelectorAll('button')].find((b) => /keep editing/i.test(b.textContent ?? ''));
    const discard = [...still!.querySelectorAll('button')].find((b) => /^discard$/i.test(b.textContent?.trim() ?? ''));
    expect(keep).toBeDefined();
    expect(discard).toBeDefined();
    // Nothing is sent while it asks.
    expect([...still!.querySelectorAll('button')].some((b) => /send invitation/i.test(b.textContent ?? ''))).toBe(false);

    keep!.click();
    await nextTick();
    expect(dialog()!.textContent).not.toMatch(/discard this invitation\?/i);
    expect(emailInputIn(dialog()!).value).toBe('someone@example.com');

    modal.vm.$emit('update:open', false);
    await nextTick();
    const discardAgain = [...dialog()!.querySelectorAll('button')].find((b) => /^discard$/i.test(b.textContent?.trim() ?? ''));
    discardAgain!.click();
    await nextTick();
    await flushPromises();
    expect(dialog(), 'discarded: the dialog closes').toBeNull();

    const third = await openInvite(component);
    expect(emailInputIn(third).value, 'the discarded address is gone').toBe('');
  });

  test('lists the members with their emails, and the pending invitation with its access and an ISO-carrying expiry', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const text = component.text();
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('ada@example.com');
    expect(text).toContain('Grace Hopper');
    expect(text).toContain('pending@example.com');
    expect(text).toMatch(/write/i);
    const time = component.find('time');
    expect(time.attributes('datetime')).toBe('2026-09-21T10:00:00.000Z');
  });

  test('with no pending invitation the section says so in the product\'s words rather than disappearing', async () => {
    mockMembers({ status: 'success', listing: { ...listing, invitations: [] } });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.text()).toMatch(/no pending invitations/i);
    expect(component.findAll('[role="alert"]')).toHaveLength(0);
  });

  test('the invite form has a labelled email field and an access choice, submits both against the composable, and a sent invitation closes the dialog', async () => {
    const inviteStatus = ref('idle');
    const { invite } = mockMembers({ status: 'success', listing });
    useWorkspaceMembersMock.mockReturnValue({ ...useWorkspaceMembersMock(), inviteStatus, invite });
    invite.mockImplementation(async () => {
      inviteStatus.value = 'sent';
    });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const opened = await openInvite(component);
    await setValue(emailInputIn(opened), 'newbie@example.com');
    expect(opened.querySelectorAll('[role="radio"]').length).toBeGreaterThanOrEqual(4);
    opened.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushPromises();
    await nextTick();
    await flushPromises();

    expect(invite).toHaveBeenCalledWith({ email: 'newbie@example.com', action: 'read' });
    expect(dialog(), 'sent: the dialog closes').toBeNull();
  });

  test('a sent invitation is confirmed in a live region on the screen — not inside the dialog — that names the address', async () => {
    mockMembers({ status: 'success', listing, inviteStatus: 'sent', inviteMessage: 'Invitation sent to newbie@example.com.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const statuses = component.findAll('main [role="status"]').map((s) => s.text());
    expect(statuses.some((t) => /newbie@example\.com/.test(t))).toBe(true);
    expect(dialog()).toBeNull();
  });

  test('a failed send is an alert inside the dialog, and the form stays, so the address typed is not lost', async () => {
    mockMembers({ status: 'success', listing, inviteStatus: 'network-error', inviteMessage: 'Could not reach the server. Try again.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const opened = await openInvite(component);
    expect(opened.querySelector('[role="alert"]')?.textContent).toMatch(/could not reach/i);
    expect(opened.querySelector('form')).not.toBeNull();
  });

  test('a workspace that is absent or not the caller\'s to manage is one calm state, and the copy admits the ambiguity', async () => {
    mockMembers({ status: 'not-found', message: 'This workspace does not exist, or you do not manage it.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    // Scoped to `main`: the contextual bar carries the sidebar toggle's own
    // live region since 2026-09-15; the notice is the screen's, in the column.
    const status = component.get('main [role="status"]');
    expect(status.text()).toMatch(/does not exist/i);
    expect(status.text()).toMatch(/manage/i);
    expect(component.find('form').exists()).toBe(false);
    expect(component.findAll('[role="alert"]')).toHaveLength(0);
    const back = component.findAll('a').find((a) => /your workspaces/i.test(a.text()));
    expect(back?.attributes('href')).toBe('/workspaces');
  });

  test('a failed load is a recoverable error with a retry that re-runs the request', async () => {
    const { load } = mockMembers({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('[role="alert"]').text()).toMatch(/cannot reach/i);
    const retry = component.findAll('button').find((b) => /retry/i.test(b.text()));
    expect(retry).toBeDefined();
    load.mockClear();
    await retry!.trigger('click');
    expect(load).toHaveBeenCalled();
  });

  // One rule for a signed-out visit to a signed-in screen: leave for
  // sign-in with this address as the return path, and show no card here —
  // the card was a dead end with a button on it (docs/UI-CHECKLIST.md §3).
  test('a signed-out visitor is sent to sign in, to come back here afterwards, and shown no card', async () => {
    mockMembers({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login(\?next=|$)/), { replace: true });
    expect(component.findAll('a').find((a) => /sign in/i.test(a.text()))).toBeUndefined();
  });

  test('the breadcrumb offers the way back to the workspace\'s home', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('a').map((a) => a.attributes('href'))).toContain('/workspaces/ws-1');
  });
});
