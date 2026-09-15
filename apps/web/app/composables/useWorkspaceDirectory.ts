import { useWorkspaces, type UseWorkspacesDeps, type WorkspaceListStatus, type WorkspaceSummary } from './useWorkspaces';

export interface UseWorkspaceDirectoryResult {
  readonly status: ComputedRef<WorkspaceListStatus>;
  readonly workspaces: ComputedRef<readonly WorkspaceSummary[]>;
  /** Load once; a list already loaded (or loading) is left alone. */
  readonly ensure: () => Promise<void>;
  /** Load again — after a workspace was created, or a failed load is retried. */
  readonly refresh: () => Promise<void>;
  readonly nameOf: (workspaceId: string) => string | null;
}

interface DirectoryRecord {
  status: WorkspaceListStatus;
  workspaces: readonly WorkspaceSummary[];
}

/**
 * The workspaces this person may open (`GET /workspaces`), kept across
 * screens. The sidebar's switcher lists them and the breadcrumb names the
 * current one, and every route mounts its own `AppShell` — so an uncached
 * list would be one request per navigation for three fields that do not
 * change. `useWorkspaces` stays the transport; this decides where the
 * answer lives (`useState`, so it survives the remount and the payload).
 */
export function useWorkspaceDirectory(deps: UseWorkspacesDeps = {}): UseWorkspaceDirectoryResult {
  const record = useState<DirectoryRecord>('dw-workspace-directory', () => ({ status: 'idle', workspaces: [] }));

  async function refresh(): Promise<void> {
    const transport = useWorkspaces(deps);
    record.value = { ...record.value, status: 'loading' };
    await transport.load();
    record.value = { status: transport.status.value, workspaces: transport.workspaces.value };
  }

  async function ensure(): Promise<void> {
    if (record.value.status === 'success' || record.value.status === 'loading') return;
    await refresh();
  }

  function nameOf(workspaceId: string): string | null {
    return record.value.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? null;
  }

  return {
    status: computed(() => record.value.status),
    workspaces: computed(() => record.value.workspaces),
    ensure,
    refresh,
    nameOf,
  };
}
