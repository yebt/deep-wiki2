/**
 * The workspace the frame's sidebar renders for.
 *
 * The layout renders the sidebar before the screen inside it runs its
 * setup, and it is the screen (`AppShell`) that enters the workspace it
 * stands in (`useCurrentWorkspace().enter`). On a request that remembers
 * no workspace — a first visit, no `dw-workspace` cookie — the server
 * therefore rendered the sidebar with *no* workspace ("Pick a workspace
 * from the menu above") and then serialised the state *with* one, and
 * the client hydrated the tree against the notice: a hydration mismatch
 * on every screen that knows its workspace on the server (the dashboard
 * always did; the read, history and members screens do since the read
 * layer), and, after it, every generated id below the sidebar off by one
 * — the dashboard's panels lost their `aria-labelledby` names on a first
 * visit (2026-09-16).
 *
 * Hydration must render what the server rendered. The value the frame
 * saw at its own setup is kept in payload state, the client renders the
 * sidebar from it until the frame is mounted, and the live workspace
 * takes over from then on — a client-side update, never a mismatch. On
 * every visit after the first, the cookie names the workspace before the
 * frame renders and the two values are the same from the start.
 */
export function useSidebarWorkspace(live: Readonly<Ref<string | null>>): ComputedRef<string | null> {
  const renderedWith = useState<string | null>('dw-frame-sidebar-workspace-rendered', () => live.value);
  const mounted = ref(false);
  if (getCurrentInstance()) {
    onMounted(() => {
      mounted.value = true;
    });
  }
  return computed(() => (mounted.value ? live.value : renderedWith.value));
}
