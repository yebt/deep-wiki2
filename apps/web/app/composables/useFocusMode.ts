export interface UseFocusModeResult {
  /** `true` when the sidebar is hidden and the document has the whole pane. */
  readonly collapsed: Ref<boolean>;
  readonly toggle: () => void;
}

/**
 * Focus mode: the sidebar hidden — to nothing, not to a rail — so the
 * person and the document are alone in the pane. Asked for by the owner
 * in those words (docs/UI-CHECKLIST.md Review Log, 2026-09-15).
 *
 * This is the shared state only. `WorkspaceSidebar` binds it to
 * `UDashboardSidebar`'s `collapsed` model, which is what writes it into
 * the frame's cookie beside the sidebar's width, reads it back on the
 * next visit, and keeps it below `lg` without effect — there the sidebar
 * is a drawer either way (§6). `SidebarToggle` is the control and the
 * keys; it flips this and announces the result.
 */
export function useFocusMode(): UseFocusModeResult {
  const collapsed = useState<boolean>('dw-focus-mode', () => false);

  function toggle(): void {
    collapsed.value = !collapsed.value;
  }

  return { collapsed, toggle };
}
