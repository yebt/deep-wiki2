import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import type { CommentThread } from '@deep-wiki/contracts';
import CommentThreadItem from './CommentThreadItem.vue';

/**
 * One comment thread as the panel renders it (comment-threads spec:
 * "Threads And Resolution State"; docs/UI-CHECKLIST.md §4.7). The three
 * placements — anchored, orphaned, unplaced — are three states of the
 * same object, each demonstrable here without a page behind it.
 */
type ItemProps = InstanceType<typeof CommentThreadItem>['$props'];

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    id: 't1',
    body: 'Is this still true after the migration?',
    author: { id: 'u1', displayName: 'Ana Ruiz' },
    createdAt: '2026-01-01T00:00:00.000Z',
    anchor: { blockId: 'b1', offsetStart: 0, offsetEnd: 10, quote: 'The lock is soft.', orphaned: false },
    resolved: false,
    resolvedAt: null,
    replies: [],
    ...overrides,
  };
}

function inApp(props: ItemProps) {
  return defineComponent({
    name: 'ThreadInApp',
    setup: () => () => h(UApp, null, { default: () => h(CommentThreadItem, props) }),
  });
}

describe('CommentThreadItem', () => {
  test('renders the excerpt it was anchored to, the author, the body, and the instant as a <time datetime>', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));

    expect(component.text()).toContain('The lock is soft.');
    expect(component.text()).toContain('Ana Ruiz');
    expect(component.text()).toContain('Is this still true after the migration?');
    expect(component.get('time').attributes('datetime')).toBe('2026-01-01T00:00:00.000Z');
  });

  test('lists replies in the order they were made, each with its author', async () => {
    const component = await mountSuspended(
      inApp({
        thread: thread({
          replies: [
            { id: 'r1', body: 'Yes, still true.', author: { id: 'u2', displayName: 'Ben' }, createdAt: '2026-01-01T00:01:00.000Z' },
            { id: 'r2', body: 'Checked again today.', author: { id: 'u1', displayName: 'Ana Ruiz' }, createdAt: '2026-01-01T00:02:00.000Z' },
          ],
        }),
        placement: 'anchored',
      }),
    );

    const replies = component.findAll('[data-testid="comment-reply"]');
    expect(replies.map((reply) => reply.text())).toEqual([
      expect.stringContaining('Ben'),
      expect.stringContaining('Ana Ruiz'),
    ]);
    expect(replies[0]!.text()).toContain('Yes, still true.');
    expect(replies[1]!.text()).toContain('Checked again today.');
  });

  test('the reply field has a programmatically associated label, and an empty reply is aria-disabled with its reason rather than removed from the tab order', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));

    const textarea = component.get('textarea');
    const labelledBy = textarea.attributes('id');
    expect(component.find(`label[for="${labelledBy}"]`).exists()).toBe(true);

    const submit = component.get('[data-testid="comment-reply-submit"]');
    expect(submit.attributes('aria-disabled')).toBe('true');
    expect(submit.attributes('disabled')).toBeUndefined();
  });

  test('submitting a reply emits the thread id and the text, and a blank reply emits nothing', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));
    const item = component.findComponent(CommentThreadItem);

    await component.get('[data-testid="comment-reply-submit"]').trigger('click');
    expect(item.emitted('reply')).toBeUndefined();

    await component.get('textarea').setValue('  Agreed.  ');
    await component.get('[data-testid="comment-reply-submit"]').trigger('click');

    expect(item.emitted('reply')).toEqual([['t1', 'Agreed.']]);
  });

  test('an open thread offers Resolve; a resolved one says so with a second signal and offers Reopen', async () => {
    const open = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));
    const openItem = open.findComponent(CommentThreadItem);
    expect(open.text()).not.toMatch(/Resolved/);
    await open.get('[data-testid="comment-resolve"]').trigger('click');
    expect(openItem.emitted('resolve')).toEqual([['t1', true]]);

    const resolved = await mountSuspended(
      inApp({ thread: thread({ resolved: true, resolvedAt: '2026-01-02T00:00:00.000Z' }), placement: 'anchored' }),
    );
    const resolvedItem = resolved.findComponent(CommentThreadItem);
    // The word, and an icon beside it — colour is never the sole carrier (§5).
    const badge = resolved.get('[data-testid="comment-resolved"]');
    expect(badge.text()).toMatch(/Resolved/);
    expect(badge.find('[aria-hidden="true"]').exists()).toBe(true);
    await resolved.get('[data-testid="comment-resolve"]').trigger('click');
    expect(resolvedItem.emitted('resolve')).toEqual([['t1', false]]);
  });

  test('an anchored thread offers to show its block in the page', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));
    const item = component.findComponent(CommentThreadItem);

    await component.get('[data-testid="comment-locate"]').trigger('click');

    expect(item.emitted('locate')).toEqual([['b1']]);
  });

  // comment-threads spec: "Orphan Is A First-Class State, Never An
  // Error". The excerpt stays, the state is named in words, and nothing
  // offers to scroll to a block that no longer exists.
  test('an orphaned thread keeps its excerpt, says plainly that the text is gone, and offers no way to locate it', async () => {
    const component = await mountSuspended(
      inApp({ thread: thread({ anchor: { blockId: 'b1', offsetStart: 0, offsetEnd: 10, quote: 'The lock is soft.', orphaned: true } }), placement: 'orphaned' }),
    );

    expect(component.text()).toContain('The lock is soft.');
    expect(component.text()).toMatch(/no longer on this page/i);
    expect(component.find('[data-testid="comment-locate"]').exists()).toBe(false);
    // It is still a thread: reply and resolve remain.
    expect(component.find('textarea').exists()).toBe(true);
    expect(component.find('[data-testid="comment-resolve"]').exists()).toBe(true);
  });

  // design.md Decision 6: a cached render that predates `data-block-id`
  // means "no anchors known", not an error. The thread is intact; only
  // its place beside the text is unknown until the backfill runs.
  test('an unplaced thread says the page has not been re-rendered yet, distinct from orphaned', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'unplaced' }));

    expect(component.text()).toContain('The lock is soft.');
    expect(component.text()).toMatch(/re-rendered/i);
    expect(component.text()).not.toMatch(/no longer on this page/i);
    expect(component.find('[data-testid="comment-locate"]').exists()).toBe(false);
  });

  test('while a write is in flight the controls are aria-disabled, not removed', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored', busy: true }));

    expect(component.get('[data-testid="comment-resolve"]').attributes('aria-disabled')).toBe('true');
    expect(component.get('[data-testid="comment-reply-submit"]').attributes('aria-disabled')).toBe('true');
  });
});
