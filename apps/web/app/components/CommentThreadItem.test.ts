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
 *
 * Rewritten 2026-09-23 as a **conversation** rather than a record with a
 * form under it (the owner: "así se ve feísimo"). What the tests below
 * hold is the shape that ruling produced: the excerpt is the thread's
 * subject, at the top; the root comment and every reply are messages of
 * one list, drawn the same way, so a reply is inside the thread rather
 * than in a nested box; Resolve is a thread-level action beside the
 * subject, not a second submit under the reply field; and the reply
 * affordance is one quiet line that grows when it is focused.
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

/** The reply affordance is quiet until it is used: everything below opens it first. */
async function openComposer(component: Awaited<ReturnType<typeof mountSuspended>>) {
  await component.get('[data-testid="comment-reply-composer"]').trigger('focusin');
}

describe('CommentThreadItem', () => {
  test('renders the excerpt it was anchored to, the author, the body, and the instant as a <time datetime>', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));

    expect(component.text()).toContain('The lock is soft.');
    expect(component.text()).toContain('Ana Ruiz');
    expect(component.text()).toContain('Is this still true after the migration?');
    expect(component.get('time').attributes('datetime')).toBe('2026-01-01T00:00:00.000Z');
  });

  // The owner's first request: the excerpt is what the thread is *about*,
  // so it stands at the top as the subject, above every message.
  test('the excerpt stands above the conversation, as its subject', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));

    const html = component.html();
    expect(html.indexOf('The lock is soft.')).toBeLessThan(html.indexOf('Is this still true after the migration?'));
  });

  // §4.11, amended 2026-09-23: a conversation says "1 minute ago", and the
  // absolute, zone-named instant stays one hover or focus away.
  test('each message carries a relative time whose title is the absolute, zone-named instant', async () => {
    const component = await mountSuspended(inApp({ thread: thread({ createdAt: new Date(Date.now() - 65_000).toISOString() }), placement: 'anchored' }));

    const time = component.get('time');
    expect(time.text()).toBe('1 minute ago');
    expect(time.attributes('title')).toMatch(/\d{4},/);
  });

  test('every message carries its author as an avatar with an accessible name beside the name in text', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));

    // The bubble is not the only carrier of who said this (§4.3, §5): the
    // name is in text beside it, and the bubble itself names the person.
    const avatar = component.get('[data-testid="comment-avatar"]');
    expect(avatar.text()).toBe('AR');
    expect(component.get('[data-testid="comment-message"]').text()).toContain('Ana Ruiz');
  });

  test('a person with no display name is named once, the same way, rather than initialled into nothing', async () => {
    const component = await mountSuspended(inApp({ thread: thread({ author: { id: null, displayName: null } }), placement: 'anchored' }));

    expect(component.text()).toContain('Unknown author');
    expect(component.get('[data-testid="comment-avatar"]').text()).toBe('UA');
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

  // The owner: a reply must be visibly *inside* the thread, not a
  // second-class nested box. One list, one message shape, one treatment.
  test('a reply is a message of the same list and the same shape as the comment that opened the thread', async () => {
    const component = await mountSuspended(
      inApp({
        thread: thread({
          replies: [{ id: 'r1', body: 'Yes, still true.', author: { id: 'u2', displayName: 'Ben' }, createdAt: '2026-01-01T00:01:00.000Z' }],
        }),
        placement: 'anchored',
      }),
    );

    const messages = component.findAll('[data-testid="comment-message"]');
    expect(messages).toHaveLength(2);
    // Same classes on both: the reply is not drawn as a lesser thing.
    expect(messages[1]!.classes()).toEqual(messages[0]!.classes());
    // And both are items of the one conversation list.
    const list = component.get('[data-testid="comment-conversation"]');
    expect(list.findAll('[data-testid="comment-message"]')).toHaveLength(2);
  });

  test('the reply field is one quiet line until it is focused, and its label is programmatically associated either way', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));

    const textarea = component.get('textarea');
    const id = textarea.attributes('id');
    expect(component.find(`label[for="${id}"]`).exists()).toBe(true);
    expect(textarea.attributes('rows')).toBe('1');
    // Quiet: the actions are not taking up the panel before anyone has
    // asked to reply.
    expect(component.find('[data-testid="comment-reply-submit"]').exists()).toBe(false);

    await openComposer(component);
    expect(component.find('[data-testid="comment-reply-submit"]').exists()).toBe(true);
  });

  test('an empty reply is aria-disabled with its reason rather than removed from the tab order', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));
    await openComposer(component);

    const submit = component.get('[data-testid="comment-reply-submit"]');
    expect(submit.attributes('aria-disabled')).toBe('true');
    expect(submit.attributes('disabled')).toBeUndefined();
    expect(submit.attributes('title')).toBeTruthy();
  });

  test('submitting a reply emits the thread id and the text, and a blank reply emits nothing', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));
    const item = component.findComponent(CommentThreadItem);
    await openComposer(component);

    await component.get('[data-testid="comment-reply-submit"]').trigger('click');
    expect(item.emitted('reply')).toBeUndefined();

    await component.get('textarea').setValue('  Agreed.  ');
    await component.get('[data-testid="comment-reply-submit"]').trigger('click');

    expect(item.emitted('reply')).toEqual([['t1', 'Agreed.']]);
  });

  // The owner: Resolve is a thread-level action and should read as one —
  // beside the subject the thread is about, not a second submit stacked
  // under the reply field.
  test('an open thread offers Resolve beside its subject; a resolved one says so with a second signal and offers Reopen', async () => {
    const open = await mountSuspended(inApp({ thread: thread(), placement: 'anchored' }));
    const openItem = open.findComponent(CommentThreadItem);
    expect(open.text()).not.toMatch(/Resolved/);
    // In the thread's header, above the conversation — not in the composer.
    expect(open.get('[data-testid="comment-thread-header"]').find('[data-testid="comment-resolve"]').exists()).toBe(true);
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
    await openComposer(component);

    expect(component.get('[data-testid="comment-resolve"]').attributes('aria-disabled')).toBe('true');
    expect(component.get('[data-testid="comment-reply-submit"]').attributes('aria-disabled')).toBe('true');
  });

  // docs/UI-CHECKLIST.md §3, "permission-denied … never a silently empty
  // list": a person who can read a conversation but not add to it gets the
  // conversation and no affordance at all — not a disabled one.
  test('a reader who may not comment sees the whole conversation and no way to add to it', async () => {
    const component = await mountSuspended(
      inApp({
        thread: thread({
          replies: [{ id: 'r1', body: 'Yes, still true.', author: { id: 'u2', displayName: 'Ben' }, createdAt: '2026-01-01T00:01:00.000Z' }],
        }),
        placement: 'anchored',
        canReply: false,
      }),
    );

    expect(component.text()).toContain('Is this still true after the migration?');
    expect(component.text()).toContain('Yes, still true.');
    expect(component.find('textarea').exists()).toBe(false);
    expect(component.find('[data-testid="comment-reply-composer"]').exists()).toBe(false);
    expect(component.find('[data-testid="comment-resolve"]').exists()).toBe(false);
    // And still locatable: reading where a comment points is not a write.
    expect(component.find('[data-testid="comment-locate"]').exists()).toBe(true);
  });

  test('a thread the server has not confirmed yet says so and offers neither reply nor resolve', async () => {
    const component = await mountSuspended(inApp({ thread: thread(), placement: 'anchored', pending: true }));

    expect(component.get('[data-testid="comment-pending"]').text()).toMatch(/Posting/);
    expect(component.find('[data-testid="comment-reply-composer"]').exists()).toBe(false);
    expect(component.find('[data-testid="comment-resolve"]').exists()).toBe(false);
  });
});
