import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import DocBodySkeleton from './DocBodySkeleton.vue';

/**
 * The document body's skeleton: three prose lines on `doc-body`'s own
 * 26px leading, so the loaded text lands where the skeleton stood
 * (docs/UI-CHECKLIST.md §3, "no layout shift on load — measure it").
 * The read screen, the edit screen and `EditorSurface` each carried a
 * copy of these three lines until 2026-09-16; §4.1 says a second copy is
 * a defect even while identical, because two copies do not stay so.
 *
 * The measurement itself is `e2e/read.spec.ts` and `e2e/editor.spec.ts`,
 * which hold the response back and compare boxes in a real browser. This
 * holds the shape those measurements depend on.
 */
describe('DocBodySkeleton', () => {
  test('renders three prose lines inside a doc-body block, each a paragraph holding an inline skeleton span', async () => {
    const component = await mountSuspended(DocBodySkeleton);

    const root = component.element as HTMLElement;
    expect(root.classList.contains('doc-body')).toBe(true);
    expect(root.classList.contains('text-doc-body')).toBe(true);
    const lines = component.findAll(':scope > p');
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // `<span>`, not `<div>`: a `<div>` inside a `<p>` is invalid HTML
      // and the server-rendered skeleton would be re-parsed with the
      // paragraph closed early, losing the line box this exists for.
      const bar = line.element.firstElementChild!;
      expect(bar.tagName).toBe('SPAN');
      expect(bar.classList.contains('inline-block')).toBe(true);
    }
  });

  test('marks the first line with the test id a screen names, so its measurement can find it', async () => {
    const component = await mountSuspended(DocBodySkeleton, { props: { lineTestId: 'read-skeleton-line' } });

    const lines = component.findAll(':scope > p');
    expect(lines[0]!.attributes('data-testid')).toBe('read-skeleton-line');
    expect(lines[1]!.attributes('data-testid')).toBeUndefined();
  });

  test('carries no test id at all when none is asked for', async () => {
    const component = await mountSuspended(DocBodySkeleton);

    expect(component.findAll('[data-testid]')).toHaveLength(0);
  });
});
