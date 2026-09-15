export interface UseCurrentWorkspaceResult {
  /** The workspace the person is in; `null` before any screen has named one. */
  readonly workspaceId: Ref<string | null>;
  readonly enter: (workspaceId: string) => void;
}

/**
 * The one workspace the person is in (apps/web/PRODUCT.md: "the workspace
 * is chosen once and everything else happens inside it"). App state rather
 * than a screen's ref: a screen that learns its workspace from a response
 * — read mode names it from `GET /pages/:id` — hands it here, and the next
 * screen's sidebar starts from it instead of from nothing.
 *
 * `useState`, so the value survives the per-route remount every screen's
 * `AppShell` goes through, and is serialised with the payload on SSR.
 */
export function useCurrentWorkspace(): UseCurrentWorkspaceResult {
  const workspaceId = useState<string | null>('dw-current-workspace', () => null);

  function enter(id: string): void {
    if (workspaceId.value !== id) workspaceId.value = id;
  }

  return { workspaceId, enter };
}
