import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import DiffInlineText, { type InlineSegment, type InlineSide } from './DiffInlineText.vue';

/** Rendered inside a `<pre>`, as the diff screens do; `textContent` is read raw because a `<pre>`'s whitespace is content. */
async function mountInPre(segments: readonly InlineSegment[], side: InlineSide = 'both') {
  const wrapper = await mountSuspended(
    defineComponent({ name: 'PreHost', setup: () => () => h('pre', null, [h(DiffInlineText, { segments, side })]) }),
  );
  return { wrapper, textContent: wrapper.find('pre').element.textContent };
}

/**
 * One edited block's text with its word-level changes as `<ins>`/`<del>`
 * (docs/UI-CHECKLIST.md §5: the element's own semantics are the second
 * signal beside colour). The three sides it can read: both interleaved
 * (unified), or one column of the side-by-side layout.
 */
describe('DiffInlineText', () => {
  const SEGMENTS: InlineSegment[] = [
    { kind: 'equal', text: 'The page as it was first saved, ' },
    { kind: 'inserted', text: 'now ' },
    { kind: 'equal', text: 'with ' },
    { kind: 'deleted', text: 'no edits yet' },
    { kind: 'inserted', text: 'one small edit' },
    { kind: 'equal', text: '.' },
  ];

  test('unified: equal text plain, insertions in <ins>, deletions in <del>, in reading order', async () => {
    const { wrapper: component, textContent } = await mountInPre(SEGMENTS);

    expect(component.findAll('ins').map((el) => el.element.textContent)).toEqual(['now ', 'one small edit']);
    expect(component.findAll('del').map((el) => el.element.textContent)).toEqual(['no edits yet']);
    expect(textContent).toBe('The page as it was first saved, now with no edits yetone small edit.');
    // The strike and the underline are the second signal, never colour alone.
    expect(component.find('del').classes()).toContain('line-through');
    expect(component.find('ins').classes()).toContain('underline');
  });

  test('the before side carries deletions and no insertions; the after side the reverse', async () => {
    const before = await mountInPre(SEGMENTS, 'before');
    expect(before.textContent).toBe('The page as it was first saved, with no edits yet.');
    expect(before.wrapper.findAll('ins')).toHaveLength(0);
    expect(before.wrapper.findAll('del')).toHaveLength(1);

    const after = await mountInPre(SEGMENTS, 'after');
    expect(after.textContent).toBe('The page as it was first saved, now with one small edit.');
    expect(after.wrapper.findAll('del')).toHaveLength(0);
    expect(after.wrapper.findAll('ins')).toHaveLength(2);
  });

  test('marks are the opaque container pairs with an inset accent ring — never a raw colour or an alpha', async () => {
    const { wrapper: component } = await mountInPre(SEGMENTS);

    const ins = component.find('ins').classes();
    expect(ins).toEqual(expect.arrayContaining(['bg-success-container', 'text-on-success-container', 'ring', 'ring-inset', 'ring-success', 'box-decoration-clone']));
    const del = component.find('del').classes();
    expect(del).toEqual(expect.arrayContaining(['bg-error-container', 'text-on-error-container', 'ring', 'ring-inset', 'ring-error', 'box-decoration-clone']));
    for (const cls of [...ins, ...del]) expect(cls).not.toMatch(/\/\d+$|#|rgb|hsl/);
  });
});
