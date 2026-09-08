import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import ReadPage from './index.vue';

const { usePageReadMock, useRouteMock } = vi.hoisted(() => ({
  usePageReadMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' } })),
}));

mockNuxtImport('usePageRead', () => usePageReadMock);
mockNuxtImport('useRoute', () => useRouteMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(ReadPage) }),
});

function mockRead(overrides: Partial<{ status: string; html: string; title: string; message: string }> = {}) {
  const load = vi.fn(async () => {});
  usePageReadMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    html: ref(overrides.html ?? ''),
    title: ref(overrides.title ?? ''),
    message: ref(overrides.message ?? ''),
    load,
  });
  return load;
}

describe('read-mode page', () => {
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockRead({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="read-skeleton"]').exists()).toBe(true);
  });

  test('renders the page title as the one h1 and the cached HTML as body content, with the semantic landmarks', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('header').exists()).toBe(true);
    expect(component.find('main').exists()).toBe(true);
    expect(component.find('footer').exists()).toBe(true);
    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('A Page');
    expect(component.html()).toContain('Hello from cache');
  });

  test('renders a distinct permission-denied state on forbidden, not a generic error, and withholds Edit', async () => {
    mockRead({ status: 'forbidden' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/don't have access/i);
    expect(component.text()).not.toMatch(/does not exist/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(false);
    expect(component.find('a[href*="/history"]').exists()).toBe(false);
  });

  test('renders a distinct not-found state, different from permission-denied, and withholds Edit', async () => {
    mockRead({ status: 'not-found' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/does not exist/i);
    expect(component.text()).not.toMatch(/don't have access/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(false);
    expect(component.find('a[href*="/history"]').exists()).toBe(false);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockRead({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp);

    const retry = component.get('button[data-testid="read-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  /**
   * The affordance that makes `/pages/:id/history` a shipped screen
   * rather than a URL. It existed, was tested, and had passing e2e, and
   * nothing anywhere linked to it — the same class of defect as the
   * route module nobody mounted, twice (scripts/checks/routes-mounted.ts).
   *
   * It is icon-only, which docs/UI-CHECKLIST.md §4.3 permits only "where
   * space genuinely forbids" a visible label — so the space was measured
   * rather than assumed. At 320x900 the app bar holds the brand (143px at
   * x=8), "Edit" (64px at x=206) and the theme toggle (28px at x=276),
   * leaving **55px** between the brand and Edit. A labelled control of
   * Edit's shape needs ~64px plus the 6px gap before "History" is even
   * spelled longer than "Edit". So the label does not fit, and §4.3's
   * exception — an accessible name *plus* a tooltip, both — is what
   * applies. That is also the existing pattern one element to the right:
   * the theme toggle is the chrome's other icon-only control and carries
   * exactly the same pair (checklist §4.1, match the nearest control).
   */
  test('offers this page’s revision history from the app bar, as a real link', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('header a[href="/pages/page-1/history"]').exists()).toBe(true);
  });

  test('the icon-only history control carries both an accessible name and a tooltip, and the name says what it is for', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mountSuspended(PageInApp);

    const history = component.get('header a[href="/pages/page-1/history"]');
    // "History" alone is ambiguous out of context — history of what?
    // The name matches the `<h1>` the link lands on.
    expect(history.attributes('aria-label')).toBe('Revision history');
    // No visible text: the name is the only carrier, which is exactly
    // why §4.3 demands the tooltip as well.
    expect(history.text()).toBe('');
    // Reka's tooltip trigger. Without it the glyph is unnamed for a
    // sighted mouse user, whose icon pack may draw it differently.
    expect(history.attributes('data-state')).toBeDefined();
  });

  test('the history control keeps its own tab stop and precedes the higher-emphasis Edit transition', async () => {
    mockRead({ status: 'success', title: 'A Page', html: '<p>Hello from cache</p>' });
    const component = await mountSuspended(PageInApp);

    const header = component.get('header').element;
    const links = Array.from(header.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'));
    // Brand, then the quieter navigation, then the emphasised one — the
    // order edit mode already uses for "Read" before "Save"
    // (docs/DESIGN-SYSTEM.md §9.1's emphasis ladder).
    expect(links).toEqual(['/', '/pages/page-1/history', '/pages/page-1/edit']);
    // A link, not a click handler: reachable and operable by keyboard
    // with no JavaScript of its own (checklist §5).
    expect(component.get('header a[href="/pages/page-1/history"]').element.tagName).toBe('A');
  });

  test('the history control is kept while the page is still loading, and withheld only where its route is a dead end', async () => {
    mockRead({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    // Transient, and the page may well resolve into something with a
    // history — the same call `Edit` already makes.
    expect(component.find('a[href*="/history"]').exists()).toBe(true);
  });
});
