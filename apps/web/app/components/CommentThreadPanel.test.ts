import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { CommentThread } from '@deep-wiki/contracts';
import CommentThreadPanel from './CommentThreadPanel.vue';

/**
 * The thread panel: the contextual pane of docs/UI-CHECKLIST.md §6, as an
 * overlay because the three-pane shell does not exist yet. `USlideover`
 * teleports its content into `document.body`, so every query below walks
 * both roots — the same two-root idiom `NavigationTreeActions.test.ts` uses
 * for its modals.
 */
type PanelProps = InstanceType<typeof CommentThreadPanel>['$props'];

function thread(overrides: Partial<CommentThread> & { id: string; blockId?: string; orphaned?: boolean }): CommentThread {
  const { blockId = 'b1', orphaned = false, ...rest } = overrides;
  return {
    body: `Body of ${overrides.id}`,
    author: { id: 'u1', displayName: 'Ana' },
    createdAt: '2026-01-01T00:00:00.000Z',
    anchor: { blockId, offsetStart: 0, offsetEnd: 4, quote: `Quote of ${overrides.id}`, orphaned },
    resolved: false,
    resolvedAt: null,
    replies: [],
    ...rest,
  };
}

const THREADS: readonly CommentThread[] = [
  thread({ id: 't1', blockId: 'b1' }),
  thread({ id: 't2', blockId: 'b2' }),
  thread({ id: 't3', blockId: 'b3', orphaned: true }),
  thread({ id: 't4', blockId: 'b4' }),
];

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mountPanel(props: Partial<PanelProps> = {}) {
  wrapper = await mountSuspended(
    defineComponent({
      name: 'PanelInApp',
      setup: () => () =>
        h(UApp, null, {
          default: () =>
            h(CommentThreadPanel, {
              open: true,
              threads: THREADS,
              focusBlockId: null,
              unplacedBlockIds: [],
              busy: false,
              writeMessage: null,
              announcement: '',
              ...props,
            }),
        }),
    }),
  );
  await nextTick();
  await nextTick();
  return wrapper;
}

function body(): HTMLElement {
  return document.body;
}

function placements(): string[] {
  return Array.from(body().querySelectorAll<HTMLElement>('[data-comment-placement]')).map((el) => el.dataset.commentPlacement!);
}

function quotes(): string[] {
  return Array.from(body().querySelectorAll('blockquote')).map((el) => el.textContent!.trim());
}

describe('CommentThreadPanel', () => {
  test('opened on one block, it shows only that block’s threads and offers the rest', async () => {
    await mountPanel({ focusBlockId: 'b2' });

    expect(quotes()).toEqual(['“Quote of t2”']);
    const showAll = body().querySelector<HTMLElement>('[data-testid="comments-show-all"]');
    expect(showAll?.textContent).toMatch(/Show all 4 comments/);
  });

  test('“Show all” is not offered when the focused block’s threads are every thread there is', async () => {
    await mountPanel({ focusBlockId: 'b1', threads: [thread({ id: 't1', blockId: 'b1' })] });

    expect(body().querySelector('[data-testid="comments-show-all"]')).toBeNull();
  });

  test('“Show all” asks the screen to drop the block focus', async () => {
    const mounted = await mountPanel({ focusBlockId: 'b2' });
    body().querySelector<HTMLElement>('[data-testid="comments-show-all"]')!.click();
    await nextTick();

    const panel = mounted.findComponent(CommentThreadPanel);
    expect(panel.emitted('showAll')).toHaveLength(1);
  });

  // The whole point of listing all threads: an orphan is reachable from
  // here even though no gutter mark can point at it (§4.7).
  test('with no block focus it lists every thread, orphans included, each with its placement', async () => {
    await mountPanel({ unplacedBlockIds: ['b4'] });

    expect(quotes()).toEqual(['“Quote of t1”', '“Quote of t2”', '“Quote of t3”', '“Quote of t4”']);
    expect(placements()).toEqual(['anchored', 'anchored', 'orphaned', 'unplaced']);
  });

  test('the description counts what the reader is looking at, naming the detached ones', async () => {
    await mountPanel({ unplacedBlockIds: ['b4'] });

    const dialog = body().querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toMatch(/4 comments on this page/);
    expect(dialog.textContent).toMatch(/1 no longer attached/);
    expect(dialog.textContent).toMatch(/1 not placed yet/);
  });

  test('a failed write is a bar-tier error notice inside the panel, announced', async () => {
    await mountPanel({ writeMessage: "Couldn't post this reply. Check your connection and try again." });

    const notice = body().querySelector<HTMLElement>('[data-notice-tier="bar"]')!;
    expect(notice.getAttribute('role')).toBe('alert');
    expect(notice.textContent).toContain("Couldn't post this reply");
  });

  test('a successful write is announced through a live region that is always present', async () => {
    await mountPanel({ announcement: 'Reply posted.' });

    const status = body().querySelector<HTMLElement>('[data-testid="comments-status"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toContain('Reply posted.');
  });

  test('reply, resolve and locate pass through from the thread they came from', async () => {
    const mounted = await mountPanel({ focusBlockId: 'b1' });
    const panel = mounted.findComponent(CommentThreadPanel);

    body().querySelector<HTMLElement>('[data-testid="comment-resolve"]')!.click();
    body().querySelector<HTMLElement>('[data-testid="comment-locate"]')!.click();
    await nextTick();

    expect(panel.emitted('resolve')).toEqual([['t1', true]]);
    expect(panel.emitted('locate')).toEqual([['b1']]);
  });

  test('closing the overlay reports it, so the screen can drop the block highlight', async () => {
    const mounted = await mountPanel();
    const panel = mounted.findComponent(CommentThreadPanel);

    body().querySelector<HTMLElement>('[role="dialog"] button[aria-label="Close"]')!.click();
    await nextTick();

    expect(panel.emitted('update:open')).toEqual([[false]]);
  });
});
