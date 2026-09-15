import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import MembersPage from './members.vue';

const { useWorkspaceMembersMock, useRouteMock } = vi.hoisted(() => ({
  useWorkspaceMembersMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { workspaceId: 'ws-1' } })),
}));

mockNuxtImport('useWorkspaceMembers', () => useWorkspaceMembersMock);
mockNuxtImport('useRoute', () => useRouteMock);

// Every screen now renders inside the workspace frame. Its sidebar — the
// tree, the switcher, the doors — is stubbed here so this file stays about
// the screen it names; `AppShell.test.ts` and `WorkspaceSidebar.test.ts`
// own the frame.
const FRAME_STUBS = { global: { stubs: { WorkspaceSidebar: true } } };

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(MembersPage) }),
});

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
  test('renders one h1 with the workspace named above it, and the shell landmarks', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Members');
    expect(component.text()).toContain('Acme Handbook');
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    // Inside the workspace frame there is no footer: the doors are the sidebar's.
    expect(component.find('footer').exists()).toBe(false);
  });

  test('renders a skeleton while it loads', async () => {
    mockMembers({ status: 'loading' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.find('[data-testid="members-skeleton"]').exists()).toBe(true);
    expect(component.find('form').exists()).toBe(false);
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

  test('the invite form has a labelled email field and an access choice, and submits both against the composable', async () => {
    const { invite } = mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const emailLabel = component.findAll('label').find((l) => /^email/i.test(l.text()));
    expect(emailLabel, 'a label whose text is "Email"').toBeDefined();
    const emailInput = component.find(`#${emailLabel!.attributes('for')}`);
    await emailInput.setValue('newbie@example.com');
    const radios = component.findAll('[role="radio"]');
    expect(radios.length).toBeGreaterThanOrEqual(4);
    await component.find('form').trigger('submit');
    await flushPromises();

    expect(invite).toHaveBeenCalledWith({ email: 'newbie@example.com', action: 'read' });
  });

  test('a sent invitation is confirmed in a live region that names the address', async () => {
    mockMembers({ status: 'success', listing, inviteStatus: 'sent', inviteMessage: 'Invitation sent to newbie@example.com.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const statuses = component.findAll('[role="status"]').map((s) => s.text());
    expect(statuses.some((t) => /newbie@example\.com/.test(t))).toBe(true);
  });

  test('a failed send is an alert and the form stays, so the address typed is not lost', async () => {
    mockMembers({ status: 'success', listing, inviteStatus: 'network-error', inviteMessage: 'Could not reach the server. Try again.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.get('[role="alert"]').text()).toMatch(/could not reach/i);
    expect(component.find('form').exists()).toBe(true);
  });

  test('a workspace that is absent or not the caller\'s to manage is one calm state, and the copy admits the ambiguity', async () => {
    mockMembers({ status: 'not-found', message: 'This workspace does not exist, or you do not manage it.' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    const status = component.get('[role="status"]');
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

  test('a signed-out visitor is offered sign-in', async () => {
    mockMembers({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('a').find((a) => /sign in/i.test(a.text()))?.attributes('href')).toBe('/login');
  });

  test('offers the way back to the workspace\'s home', async () => {
    mockMembers({ status: 'success', listing });
    const component = await mountSuspended(PageInApp, FRAME_STUBS);

    expect(component.findAll('a').map((a) => a.attributes('href'))).toContain('/workspaces/ws-1');
  });
});
