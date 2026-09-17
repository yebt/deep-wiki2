import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import NewWorkspacePage from './new.vue';

const { useCreateWorkspaceMock, navigateToMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn(async () => {}),
  useCreateWorkspaceMock: vi.fn(),
}));

mockNuxtImport('useCreateWorkspace', () => useCreateWorkspaceMock);
mockNuxtImport('navigateTo', () => navigateToMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(NewWorkspacePage) }),
});

function mockCreate(overrides: { status?: string; message?: string; limit?: unknown; workspace?: unknown } = {}) {
  const create = vi.fn(async () => {});
  useCreateWorkspaceMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    message: ref(overrides.message ?? ''),
    limit: ref(overrides.limit ?? null),
    workspace: ref(overrides.workspace ?? null),
    create,
  });
  return { create };
}

describe('new workspace screen', () => {
  test('renders one h1 and the shell landmarks', async () => {
    mockCreate();
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
  });

  test('both fields have a programmatically associated label, and the slug follows the name until it is edited by hand', async () => {
    mockCreate();
    const component = await mountSuspended(PageInApp);

    const labelFor = (text: RegExp) => component.findAll('label').find((l) => text.test(l.text()));
    const nameLabel = labelFor(/^name/i);
    const slugLabel = labelFor(/^slug/i);
    expect(nameLabel, 'a label whose text is "Name"').toBeDefined();
    expect(slugLabel, 'a label whose text is "Slug"').toBeDefined();
    const nameInput = component.find(`#${nameLabel!.attributes('for')}`);
    const slugInput = component.find(`#${slugLabel!.attributes('for')}`);
    expect(nameInput.exists()).toBe(true);
    expect(slugInput.exists()).toBe(true);

    await nameInput.setValue('Acme Handbook — Diseño');
    await nextTick();
    expect((slugInput.element as HTMLInputElement).value).toBe('acme-handbook-diseno');

    await slugInput.setValue('handbook');
    await nameInput.setValue('Acme Handbook 2');
    await nextTick();
    expect((slugInput.element as HTMLInputElement).value).toBe('handbook');
  });

  test('submitting sends the name and slug typed', async () => {
    const { create } = mockCreate();
    const component = await mountSuspended(PageInApp);
    const labelFor = (text: RegExp) => component.findAll('label').find((l) => text.test(l.text()))!;
    await component.find(`#${labelFor(/^name/i).attributes('for')}`).setValue('Acme Handbook');
    await nextTick();

    await component.find('form').trigger('submit');
    await flushPromises();

    expect(create).toHaveBeenCalledWith({ name: 'Acme Handbook', slug: 'acme-handbook' });
  });

  test('at the plan limit the refusal names the number and the plan, offers the list, and shows no form', async () => {
    mockCreate({ status: 'plan-limit', limit: { planName: 'team', maxWorkspaces: 3 }, message: 'Your plan allows 3 workspaces.' });
    const component = await mountSuspended(PageInApp);

    const status = component.get('[role="status"]');
    expect(status.text()).toMatch(/3/);
    expect(status.text()).toMatch(/team/);
    expect(component.find('form').exists()).toBe(false);
    expect(component.findAll('[role="alert"]')).toHaveLength(0);
    const back = component.findAll('a').find((a) => /workspaces/i.test(a.text()));
    expect(back?.attributes('href')).toBe('/workspaces');
  });

  test('with no plan the refusal names who can fix it and offers no retry', async () => {
    mockCreate({ status: 'no-plan', message: 'Your account has no plan yet.' });
    const component = await mountSuspended(PageInApp);

    expect(component.get('[role="status"]').text()).toMatch(/operator/i);
    expect(component.find('form').exists()).toBe(false);
    expect(component.findAll('button').find((b) => /retry/i.test(b.text()))).toBeUndefined();
  });

  test('a taken slug keeps the form and what was typed, with the error attached to the slug field', async () => {
    mockCreate({ status: 'slug-taken', message: 'That slug is already taken. Choose another.' });
    const component = await mountSuspended(PageInApp);
    const labelFor = (text: RegExp) => component.findAll('label').find((l) => text.test(l.text()))!;
    const slugInput = component.find(`#${labelFor(/^slug/i).attributes('for')}`);

    expect(component.find('form').exists()).toBe(true);
    const describedBy = slugInput.attributes('aria-describedby') ?? '';
    const described = describedBy
      .split(/\s+/)
      .map((id) => component.find(`#${id}`))
      .filter((el) => el.exists())
      .map((el) => el.text())
      .join(' ');
    expect(described).toMatch(/already taken/i);
  });

  test('a failed request is an alert with the form still there, so nothing typed is lost', async () => {
    mockCreate({ status: 'network-error', message: 'Could not reach the server. Try again.' });
    const component = await mountSuspended(PageInApp);

    expect(component.get('[role="alert"]').text()).toMatch(/could not reach/i);
    expect(component.find('form').exists()).toBe(true);
  });

  test('success names the workspace and offers inviting the team as the next step, plus the tree', async () => {
    mockCreate({ status: 'success', message: 'Created Acme Handbook.', workspace: { workspaceId: 'ws-9', rootNodeId: 'root-9', slug: 'acme-handbook' } });
    const component = await mountSuspended(PageInApp);

    expect(component.get('[role="status"]').text()).toMatch(/Acme Handbook/);
    const hrefs = component.findAll('a').map((a) => a.attributes('href'));
    expect(hrefs).toContain('/w/acme-handbook/members');
    expect(hrefs).toContain('/w/acme-handbook');
    expect(component.find('form').exists()).toBe(false);
  });

  // One rule for a signed-out visit to a signed-in screen: leave for
  // sign-in with this address as the return path, and show no card here —
  // the card was a dead end with a button on it (docs/UI-CHECKLIST.md §3).
  test('a signed-out visitor is sent to sign in, to come back here afterwards, and shown no card', async () => {
    mockCreate({ status: 'unauthenticated' });
    const component = await mountSuspended(PageInApp);

    expect(navigateToMock).toHaveBeenCalledWith(expect.stringMatching(/^\/login(\?next=|$)/), { replace: true });
    expect(component.findAll('a').find((a) => /sign in/i.test(a.text()))).toBeUndefined();
  });
});
