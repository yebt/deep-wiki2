<script setup lang="ts">
/**
 * What stands at an old address — `/pages/<id>`, `/books/<id>/history`,
 * `/workspaces/<id>` — for the moment before `middleware/legacy-routes.ts`
 * moves the person to the new one. Registered as the page of those routes
 * in `nuxt.config.ts` (`pages:extend`) rather than as eight page files
 * whose only content would be this sentence.
 *
 * Almost never seen: the middleware resolves the new address on the
 * server and answers a 301, so the browser never renders this route. It
 * renders when the server could not ask the API on the person's behalf —
 * a deployment where the API lives on another host and its cookie never
 * reaches the Nuxt server — and the browser is about to. An honest
 * in-between rather than a blank: `PageNotice`, the one container a
 * screen shows instead of its content (docs/UI-CHECKLIST.md §4.1), on the
 * document frame, since the workspace it belongs to is exactly what is
 * not yet known.
 */
</script>

<template>
  <AppShell column="measure" center>
    <PageNotice icon="i-lucide-corner-down-right" heading="Taking you to this address's new home">
      Pages, books and workspaces now live under their workspace's name. One moment while the new address is found.
    </PageNotice>
  </AppShell>
</template>
