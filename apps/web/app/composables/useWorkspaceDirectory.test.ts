import { describe, expect, test, vi } from 'vitest';
import { useWorkspaceDirectory } from './useWorkspaceDirectory';

/**
 * The workspaces the person may open, kept across screens: the sidebar's
 * switcher and the breadcrumb both need a workspace's *name*, and every
 * route mounts its own shell, so an uncached list would be one request per
 * navigation for three fields that do not change. Loaded once, read
 * anywhere, refreshed on demand.
 */
describe('useWorkspaceDirectory', () => {
  test('loads once and names a workspace by id from any instance', async () => {
    const fetchWorkspaces = vi.fn(async () => ({ workspaces: [{ id: 'ws-dir-1', name: 'Acme', slug: 'acme' }] }));
    const first = useWorkspaceDirectory({ fetchWorkspaces });
    await first.ensure();
    await first.ensure();

    const second = useWorkspaceDirectory({ fetchWorkspaces });

    expect(fetchWorkspaces).toHaveBeenCalledTimes(1);
    expect(second.nameOf('ws-dir-1')).toBe('Acme');
    expect(second.workspaces.value.map((workspace) => workspace.slug)).toEqual(['acme']);
  });

  test('an unknown id has no name, so the caller can show the address rather than a wrong name', async () => {
    const directory = useWorkspaceDirectory({ fetchWorkspaces: vi.fn(async () => ({ workspaces: [] })) });
    await directory.ensure();

    expect(directory.nameOf('nope')).toBeNull();
  });

  test('a failed load leaves the list empty and the status honest, and `refresh` tries again', async () => {
    const fetchWorkspaces = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ workspaces: [{ id: 'ws-dir-2', name: 'Later', slug: 'later' }] });
    const directory = useWorkspaceDirectory({ fetchWorkspaces });

    // `refresh`, not `ensure`: the directory is app state, and an earlier
    // test in this file has already loaded it.
    await directory.refresh();
    expect(directory.status.value).toBe('network-error');
    expect(directory.workspaces.value).toEqual([]);

    await directory.refresh();
    expect(directory.status.value).toBe('success');
    expect(directory.nameOf('ws-dir-2')).toBe('Later');
  });
});
