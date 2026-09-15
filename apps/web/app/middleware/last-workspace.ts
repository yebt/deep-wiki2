/**
 * `/` opens onto the last workspace the person was in, and onto the
 * workspace list only when there is none to reopen.
 *
 * A person lives in one workspace at a time, the way a person lives in
 * one Obsidian vault, and Obsidian reopens the last vault
 * (apps/web/PRODUCT.md). Until 2026-09-15 `/` redirected to the list on
 * every visit, so the front door led to a lobby rather than into the room.
 *
 * Route middleware rather than `definePageMeta({ redirect })`: a router
 * redirect is a static record and cannot read a cookie, and this decision
 * has to be made on the server — before any screen renders — so the person
 * never sees the list flash by on the way in. `useCurrentWorkspace` owns
 * the cookie and validates what it holds; this file only routes on it.
 *
 * A remembered workspace the person can no longer open (a revoked grant,
 * a different account at the same browser) lands on the dashboard's own
 * "does not exist" state with the list one click away — a real state, and
 * one that discloses nothing (docs/UI-CHECKLIST.md §3).
 */
export default defineNuxtRouteMiddleware(() => {
  const remembered = rememberedWorkspaceId();
  return navigateTo(remembered ? `/workspaces/${remembered}` : '/workspaces', { replace: true });
});
