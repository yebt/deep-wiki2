import { describe, expect, test } from 'vitest';
import { useCurrentWorkspace } from './useCurrentWorkspace';

/**
 * The workspace the person is *in* — one at a time, the way a person is in
 * one Obsidian vault (apps/web/PRODUCT.md). Shared app state, not a
 * per-screen ref: a screen that learns its workspace from a response
 * (read mode) hands it here, and the next screen's sidebar starts from it
 * instead of from nothing.
 */
describe('useCurrentWorkspace', () => {
  test('is shared: an id set from one call site is read from another', () => {
    const a = useCurrentWorkspace();
    const b = useCurrentWorkspace();

    a.enter('ws-1');

    expect(b.workspaceId.value).toBe('ws-1');
  });

  test('entering the same workspace again is a no-op, and a different one replaces it', () => {
    const { workspaceId, enter } = useCurrentWorkspace();
    enter('ws-1');
    enter('ws-1');
    expect(workspaceId.value).toBe('ws-1');

    enter('ws-2');
    expect(workspaceId.value).toBe('ws-2');
  });
});
