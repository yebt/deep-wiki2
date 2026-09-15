import { describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { COMMENTS_VISIBILITY_COOKIE, useCommentsVisibility } from './useCommentsVisibility';

/**
 * Whether the read screen draws the comment marks and offers the thread
 * panel — a display preference, for someone who can comment, remembered
 * per browser in a cookie like the sidebar's width. What it is *not* is
 * a fetch or a permission: the screen's suite holds that hiding changes
 * nothing about what is requested or what a read-only caller sees.
 */
describe('useCommentsVisibility', () => {
  test('starts shown, is shared between call sites, and remembers the choice in a cookie', async () => {
    const a = useCommentsVisibility();
    const b = useCommentsVisibility();
    expect(a.hidden.value).toBe(false);

    a.toggle();
    await nextTick();

    expect(b.hidden.value).toBe(true);
    expect(document.cookie).toContain(`${COMMENTS_VISIBILITY_COOKIE}=hidden`);

    b.toggle();
    await nextTick();
    expect(a.hidden.value).toBe(false);
    expect(document.cookie).toContain(`${COMMENTS_VISIBILITY_COOKIE}=shown`);
  });
});
