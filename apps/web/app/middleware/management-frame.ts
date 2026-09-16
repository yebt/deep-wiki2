/**
 * A management screen that is not about one workspace — the instance's
 * registration settings, the person's own profile — stands inside the
 * workspace frame, with the management sidebar, whenever a workspace is
 * remembered; and in the plain document frame when none is.
 *
 * Why not always the frame: the operator who needs `/admin/registration`
 * most may hold no workspace at all (`e2e/navigation.spec.ts`'s seeded
 * Super Root carries no grant anywhere), and a frame around them would be
 * an empty sidebar with nothing to orient around, or a silently adopted
 * workspace the setting has nothing to do with. Why not never: a person
 * who is in a workspace and steps out to an instance-wide setting should
 * keep their room around them and the management doors beside them,
 * rather than be dropped into a different product (the document frame)
 * for one screen.
 *
 * The memory is the cookie `useCurrentWorkspace` writes — the one `/`
 * reopens on (`middleware/last-workspace.ts`). Route middleware rather
 * than a page-level decision because `setPageLayout` must run before the
 * layout renders on the server, or the first paint and the hydrated one
 * disagree. The page reads the same cookie for its `AppShell`, so the
 * layout and the pane cannot disagree either.
 */
export default defineNuxtRouteMiddleware(() => {
  if (rememberedWorkspaceId()) setPageLayout('workspace');
});
