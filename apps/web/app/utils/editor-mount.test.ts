// @vitest-environment node
import { describe, expect, test, vi } from 'vitest';
import { createEditorMountLoader, loadEditorMount, type EditorMountModule } from './editor-mount';

/**
 * One importer for the `"./mount"` chunk, shared by everything that wants
 * it early — the edit route (before its session request), the read
 * screen's "Edit" control on pointer intent — and by the surface that
 * finally needs it. The contract: one `import()` however many callers,
 * the parser warmed inside that same promise, and a failed load not
 * remembered forever.
 */
describe('createEditorMountLoader()', () => {
  function fakeModule(): EditorMountModule {
    return { fromMarkdown: vi.fn() } as unknown as EditorMountModule;
  }

  test('imports once: every caller gets the same promise', async () => {
    const mod = fakeModule();
    const importer = vi.fn(async () => mod);
    const load = createEditorMountLoader(importer);

    const first = load();
    const second = load();
    await first;
    const third = load();

    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(importer).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(mod);
  });

  test('warms the parser inside the import promise, before any caller sees the module', async () => {
    const mod = fakeModule();
    const load = createEditorMountLoader(async () => mod);

    const resolved = await load();

    expect(resolved).toBe(mod);
    expect(mod.fromMarkdown).toHaveBeenCalledWith('');
    expect(mod.fromMarkdown).toHaveBeenCalledTimes(1);
  });

  test('a failed import is not cached: the next caller tries again', async () => {
    const mod = fakeModule();
    const importer = vi
      .fn<() => Promise<EditorMountModule>>()
      .mockRejectedValueOnce(new Error('Failed to fetch dynamically imported module'))
      .mockResolvedValueOnce(mod);
    const load = createEditorMountLoader(importer);

    await expect(load()).rejects.toThrow('Failed to fetch');
    await expect(load()).resolves.toBe(mod);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});

describe('loadEditorMount()', () => {
  test('resolves to the real "./mount" module, converters included', async () => {
    const mod = await loadEditorMount();

    expect(typeof mod.createEditorView).toBe('function');
    expect(typeof mod.fromMarkdown).toBe('function');
    expect(typeof mod.toMarkdown).toBe('function');
  }, 60_000);
});
