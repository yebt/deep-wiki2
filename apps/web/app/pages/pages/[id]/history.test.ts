import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import HistoryPage from './history.vue';

const { usePageHistoryMock, useRouteMock } = vi.hoisted(() => ({
  usePageHistoryMock: vi.fn(),
  useRouteMock: vi.fn(() => ({ params: { id: 'page-1' } })),
}));

mockNuxtImport('usePageHistory', () => usePageHistoryMock);
mockNuxtImport('useRoute', () => useRouteMock);

const PageInApp = defineComponent({
  name: 'PageInApp',
  setup: () => () => h(UApp, null, { default: () => h(HistoryPage) }),
});

interface Revision {
  id: string;
  authorId: string | null;
  authorDisplayName: string | null;
  createdAt: string;
  changesetId: string | null;
}

function mockHistory(overrides: Partial<{ status: string; revisions: Revision[]; message: string }> = {}) {
  const load = vi.fn(async () => {});
  usePageHistoryMock.mockReturnValue({
    status: ref(overrides.status ?? 'idle'),
    revisions: ref(overrides.revisions ?? []),
    message: ref(overrides.message ?? ''),
    load,
  });
  return load;
}

const TWO_REVISIONS: Revision[] = [
  { id: 'rev-2', authorId: 'user-1', authorDisplayName: 'Ada Lovelace', createdAt: '2026-01-02T00:00:00.000Z', changesetId: 'cs-1' },
  { id: 'rev-1', authorId: 'user-1', authorDisplayName: 'Ada Lovelace', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null },
];

const originalTz = process.env.TZ;

afterEach(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('page-history screen', () => {
  test('renders the loading skeleton, not a spinner, while the request is in flight', async () => {
    mockHistory({ status: 'loading' });
    const component = await mountSuspended(PageInApp);

    expect(component.find('[data-testid="history-skeleton"]').exists()).toBe(true);
  });

  test('renders every revision newest-first with its author, timestamp and changeset membership', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp);

    const items = component.findAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]!.text()).toContain('Ada Lovelace');
    expect(items[0]!.text()).toContain('Part of a changeset');
    // The oldest revision (last in the newest-first list) has nothing
    // before it — a real state, not an edge case (revision-history spec).
    expect(items[1]!.text()).not.toContain('Part of a changeset');
    expect(items[1]!.text()).toMatch(/initial version/i);
  });

  test("renders each revision's timestamp in the viewer's own timezone, not UTC", async () => {
    // One instant, two viewers. 2026-01-02T00:00:00Z is still the evening
    // of the 1st in New York and mid-morning of the 2nd in Tokyo, so a
    // formatter stuck on UTC — or on whichever zone this machine happens
    // to sit in — cannot satisfy both halves.
    process.env.TZ = 'America/New_York';
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const inNewYork = await mountSuspended(PageInApp);
    expect(inNewYork.findAll('time')[0]!.text()).toBe('Jan 1, 2026, 7:00 PM EST');

    process.env.TZ = 'Asia/Tokyo';
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const inTokyo = await mountSuspended(PageInApp);
    expect(inTokyo.findAll('time')[0]!.text()).toBe('Jan 2, 2026, 9:00 AM GMT+9');
  });

  test('the <time> element carries the exact ISO instant, whatever the viewer sees', async () => {
    // The localised string is for a human; `datetime` is the value that
    // must survive the display choice — an assistive technology, a copied
    // row, or a later diff view reads this, not the rendering above it.
    process.env.TZ = 'Asia/Tokyo';
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp);

    const times = component.findAll('time');
    expect(times).toHaveLength(2);
    expect(times[0]!.attributes('datetime')).toBe('2026-01-02T00:00:00.000Z');
    expect(times[1]!.attributes('datetime')).toBe('2026-01-01T00:00:00.000Z');
    // …and the attribute is not simply an echo of the visible text.
    expect(times[0]!.attributes('datetime')).not.toBe(times[0]!.text());
  });

  test('a page with exactly one revision renders it as the initial version, not a comparison target', async () => {
    mockHistory({ status: 'success', revisions: [TWO_REVISIONS[1]!] });
    const component = await mountSuspended(PageInApp);

    const items = component.findAll('li');
    expect(items).toHaveLength(1);
    expect(items[0]!.text()).toMatch(/initial version/i);
    expect(items[0]!.find('button[aria-disabled="true"]').exists()).toBe(false);
  });

  test('the compare control is inert (aria-disabled) rather than removed from the tab order', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp);

    const compare = component.get('button[aria-disabled="true"]');
    expect(compare.text()).toMatch(/compare/i);
    expect(compare.attributes('disabled')).toBeUndefined();
  });

  test('an author-less revision renders a named fallback, never a blank row', async () => {
    mockHistory({
      status: 'success',
      revisions: [{ id: 'rev-1', authorId: null, authorDisplayName: null, createdAt: '2026-01-01T00:00:00.000Z', changesetId: null }],
    });
    const component = await mountSuspended(PageInApp);

    expect(component.get('li').text()).toMatch(/unknown author/i);
  });

  test('renders a single not-found state — absence and denial are indistinguishable here', async () => {
    mockHistory({ status: 'not-found' });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/does not exist/i);
    expect(component.findAll('li')).toHaveLength(0);
  });

  test('the empty state names the object and offers a path forward, distinct from not-found', async () => {
    mockHistory({ status: 'success', revisions: [] });
    const component = await mountSuspended(PageInApp);

    expect(component.text()).toMatch(/no revisions yet/i);
    expect(component.find('a[href*="/edit"]').exists()).toBe(true);
  });

  test('renders a recoverable error state with a retry action that reloads', async () => {
    const load = mockHistory({ status: 'network-error', message: 'Cannot reach the server.' });
    const component = await mountSuspended(PageInApp);

    const retry = component.get('button[data-testid="history-retry"]');
    await retry.trigger('click');

    expect(load).toHaveBeenCalled();
  });

  test('renders exactly one h1 for the screen, at the same type role every state uses', async () => {
    mockHistory({ status: 'success', revisions: TWO_REVISIONS });
    const component = await mountSuspended(PageInApp);

    expect(component.findAll('h1')).toHaveLength(1);
  });
});
