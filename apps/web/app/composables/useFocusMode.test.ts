import { describe, expect, test } from 'vitest';
import { useFocusMode } from './useFocusMode';

/**
 * Focus mode: the sidebar hidden, the document alone. The owner asked for
 * it in those words — "toggle the sidebar for a cleaner interaction with
 * the document" — and *nothing*, not a rail: the tree comes back on the
 * same control or the same keys, and until then the pane is the room.
 *
 * This is the state; the sidebar binds it to Nuxt UI's collapse, which
 * is what persists it in the same cookie as the sidebar's width
 * (`WorkspaceSidebar.test.ts`). Shared, so the control in the content
 * pane's bar and the sidebar read one value.
 */
describe('useFocusMode', () => {
  test('starts shown, and one call site’s toggle is read by another', () => {
    const a = useFocusMode();
    const b = useFocusMode();
    expect(a.collapsed.value).toBe(false);

    a.toggle();

    expect(b.collapsed.value).toBe(true);
    b.toggle();
    expect(a.collapsed.value).toBe(false);
  });
});
