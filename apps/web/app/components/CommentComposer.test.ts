import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import type { MentionCandidate } from '@deep-wiki/editor';
import CommentComposer from './CommentComposer.vue';

/**
 * The composer as a person meets it: a labelled field that takes focus,
 * Post that explains itself while empty, Cancel, Ctrl+Enter, and the `@`
 * menu's keyboard contract (docs/UI-CHECKLIST.md §4.6, §5). The state
 * machine itself is `useNewThread.test.ts`; the trigger's string rules are
 * `mention-trigger.test.ts`.
 */
const searches: string[] = [];
const candidates: MentionCandidate[] = [
  { id: 'u1', type: 'user', label: 'Ana Lima' },
  { id: 'p1', type: 'page', label: 'Runbook' },
];

vi.mock('~/composables/useMentionCandidates', () => ({
  useMentionCandidates: () => ({
    search: async (query: string) => {
      searches.push(query);
      return candidates;
    },
    checkAccess: async (userId: string) => userId !== 'u1',
  }),
}));

type ComposerProps = InstanceType<typeof CommentComposer>['$props'];

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  searches.length = 0;
});

async function mountComposer(props: Partial<ComposerProps> = {}) {
  wrapper?.unmount();
  const body = ref('');
  const mentions = ref<{ id: string; label: string }[]>([]);
  wrapper = await mountSuspended(
    defineComponent({
      name: 'ComposerInApp',
      setup: () => () =>
        h(UApp, null, {
          default: () =>
            h(CommentComposer, {
              target: { blockId: 'd:0123456789ab#0', quote: null, excerpt: 'The block.' },
              status: 'composing',
              workspaceId: 'ws-1',
              pageId: 'page-1',
              body: body.value,
              'onUpdate:body': (value: string) => (body.value = value),
              mentions: mentions.value,
              'onUpdate:mentions': (value: { id: string; label: string }[]) => (mentions.value = value),
              ...props,
            }),
        }),
    }),
    { attachTo: document.body },
  );
  await nextTick();
  return { wrapper, body, mentions, composer: () => wrapper!.findComponent(CommentComposer) };
}

function textarea(): HTMLTextAreaElement {
  return document.querySelector<HTMLTextAreaElement>('textarea[data-testid="comment-composer-body"]')!;
}

describe('CommentComposer', () => {
  test('names what the thread is about, labels its field, and takes focus', async () => {
    const { wrapper } = await mountComposer();
    await nextTick();

    expect(wrapper.text()).toContain('On this block:');
    expect(wrapper.get('[data-testid="comment-composer-excerpt"]').text()).toContain('The block.');
    expect(wrapper.get('label').text()).toBe('Comment');
    expect(document.activeElement).toBe(textarea());
  });

  test('a selection is said to be one', async () => {
    const { wrapper } = await mountComposer({ target: { blockId: 'b', quote: 'the words', excerpt: 'the words' } });
    expect(wrapper.text()).toContain('On the selected text:');
  });

  test('Post explains itself while there is nothing to post, and posts once there is (also on Ctrl+Enter)', async () => {
    const { wrapper, composer } = await mountComposer();
    const post = wrapper.get('[data-testid="comment-post"]');
    expect(post.attributes('aria-disabled')).toBe('true');
    expect(post.attributes('title')).toBe('Write a comment first.');
    await post.trigger('click');
    expect(composer().emitted('post')).toBeUndefined();

    const filled = await mountComposer({ body: 'Something.' });
    const ready = filled.wrapper.get('[data-testid="comment-post"]');
    expect(ready.attributes('aria-disabled')).toBeUndefined();
    await ready.trigger('click');
    expect(filled.composer().emitted('post')).toHaveLength(1);

    await filled.wrapper.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    expect(filled.composer().emitted('post')).toHaveLength(2);
  });

  test('Cancel asks the screen to close the composer; while posting both controls explain the wait', async () => {
    const { wrapper, composer } = await mountComposer({ body: 'x' });
    await wrapper.get('[data-testid="comment-cancel"]').trigger('click');
    expect(composer().emitted('cancel')).toHaveLength(1);

    const posting = await mountComposer({ body: 'x', status: 'posting' });
    expect(posting.wrapper.get('[data-testid="comment-post"]').attributes('title')).toBe('Posting your comment…');
    expect(posting.wrapper.get('[data-testid="comment-cancel"]').attributes('aria-disabled')).toBe('true');
  });

  test('typing @ opens the mention menu with people only; arrows move, Enter confirms into the text and records the mention, and access is checked', async () => {
    const { wrapper, body, mentions } = await mountComposer();
    const field = textarea();
    field.value = 'cc @an';
    field.setSelectionRange(6, 6);
    await wrapper.find('textarea').trigger('input');
    await vi.waitFor(() => expect(wrapper.find('[role="listbox"]').exists()).toBe(true));
    expect(searches).toEqual(['an']);
    // People only — the page candidate is not offered.
    expect(wrapper.findAll('[role="option"]').map((option: { text: () => string }) => option.text())).toEqual(['Ana Lima']);
    expect(wrapper.find('textarea').attributes('aria-expanded')).toBe('true');
    expect(wrapper.find('textarea').attributes('aria-activedescendant')).toBe(wrapper.get('[role="option"]').attributes('id'));

    await wrapper.find('textarea').trigger('keydown', { key: 'Enter' });
    expect(body.value).toBe('cc @Ana Lima ');
    expect(mentions.value).toEqual([{ id: 'u1', label: 'Ana Lima' }]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ana Lima does not have access to this page yet'));
  });

  test('Escape closes only the menu, and the panel never hears it', async () => {
    const { wrapper } = await mountComposer();
    const field = textarea();
    field.value = '@';
    field.setSelectionRange(1, 1);
    await wrapper.find('textarea').trigger('input');
    await vi.waitFor(() => expect(wrapper.find('[role="listbox"]').exists()).toBe(true));

    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    const stop = vi.spyOn(escape, 'stopPropagation');
    field.dispatchEvent(escape);
    await nextTick();
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
    expect(stop).toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(true);
  });
});
