import { describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { EDITOR_VIEW_COOKIE, useEditorView } from './useEditorView';

/**
 * Which of edit mode's two views a person last chose — visual or source
 * — remembered per browser in a cookie like the comments toggle
 * (`useCommentsVisibility`) and the sidebar's width. A display
 * preference: it decides nothing about what is saved.
 */
describe('useEditorView', () => {
  test('starts visual, is shared between call sites, and remembers the choice in a cookie', async () => {
    const a = useEditorView();
    const b = useEditorView();
    expect(a.view.value).toBe('visual');

    a.set('source');
    await nextTick();

    expect(b.view.value).toBe('source');
    expect(document.cookie).toContain(`${EDITOR_VIEW_COOKIE}=source`);

    b.set('visual');
    await nextTick();
    expect(a.view.value).toBe('visual');
    expect(document.cookie).toContain(`${EDITOR_VIEW_COOKIE}=visual`);
  });
});
