import { describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { DIFF_LAYOUT_COOKIE, useDiffLayout } from './useDiffLayout';

/**
 * Which way the diff screens lay a block's two sides out — one column
 * with the changes inline, or before and after side by side — a display
 * preference remembered per browser in a cookie, exactly as the comments
 * overlay's visibility is (`useCommentsVisibility`, `dw-comments`).
 */
describe('useDiffLayout', () => {
  test('starts unified, is shared between call sites, and remembers the choice in a cookie', async () => {
    const a = useDiffLayout();
    const b = useDiffLayout();
    expect(a.layout.value).toBe('unified');

    a.set('side-by-side');
    await nextTick();

    expect(b.layout.value).toBe('side-by-side');
    expect(document.cookie).toContain(`${DIFF_LAYOUT_COOKIE}=side-by-side`);

    b.set('unified');
    await nextTick();
    expect(a.layout.value).toBe('unified');
    expect(document.cookie).toContain(`${DIFF_LAYOUT_COOKIE}=unified`);
  });
});
