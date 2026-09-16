<script setup lang="ts">
/**
 * `/workspaces/:id/settings` — the workspace's own settings. Not built
 * yet, and this screen says so.
 *
 * It exists because the management sidebar names it. The sidebar shows
 * the shape of management — Members, Settings, AI & models under the
 * workspace; Registration under the instance; Profile under the person —
 * and a door in that list either opens onto a screen or is a lie. A
 * disabled item was the other honest option and was rejected on a
 * measured ground: `UNavigationMenu` renders a disabled link with
 * `tabindex="-1"`, out of the tab order, with its reason behind a hover a
 * keyboard user cannot perform (docs/UI-CHECKLIST.md §5). So the door
 * opens, onto the product's own "not built yet" state: what is true
 * today, and where the thing the person probably came for actually lives
 * (§3 — a real next action, never a dead end).
 *
 * Pre-build contract (§2), for the placeholder it is: the user is a
 * workspace admin looking for a name, a slug, a plan; nothing here is
 * designed against data the API does not serve — `PUT /workspaces/:id`
 * does not exist; the non-goal is building any of it here.
 */
definePageMeta({ layout: 'workspace', sidebar: 'management' });

const route = useRoute();
const workspaceId = route.params.workspaceId as string;

useSeoMeta({ title: 'Settings — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="workspaceId" title="Settings">
    <PageHeading heading="Settings" />

    <PageNotice icon="i-lucide-construction" heading="Not built yet" :level="2">
      A workspace's name and slug are set when it is created, and nothing about it can be changed here yet. Who is in
      the workspace, and who is invited, is managed under Members.
      <template #actions>
        <UButton :to="`/workspaces/${workspaceId}/members`" variant="outline" color="neutral" icon="i-lucide-users">Members</UButton>
      </template>
    </PageNotice>
  </AppShell>
</template>
