<script setup lang="ts">
/**
 * `/account` — the person's own settings: display name, password, avatar.
 * Not built yet, and this screen says so.
 *
 * The door is the "You" section of the management sidebar; it opens onto
 * an honest state rather than being disabled, for the reason recorded on
 * `workspaces/[workspaceId]/settings.vue`. What *can* be done today is
 * offered: a password is changed through the reset link from sign-in.
 *
 * **Which frame.** This is the person's, not a workspace's — but a person
 * reaches it from inside a workspace, and leaving the room to change a
 * name would be a jolt. So it stands in the workspace frame with the
 * management sidebar whenever a workspace is remembered
 * (`middleware/management-frame.ts` picks the layout from the same cookie
 * `/` reopens on), and in the plain document frame when none is — a fresh
 * browser, a cleared one — where an empty sidebar would orient nobody.
 * The same rule `/admin/registration` follows.
 */
definePageMeta({ middleware: ['management-frame'], sidebar: 'management' });

/** The workspace the frame stands on, or `undefined` for the document frame — the same fact the middleware read. */
const remembered = rememberedWorkspaceId() ?? undefined;

useSeoMeta({ title: 'Profile — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="remembered" title="Profile">
    <!-- The eyebrow adds what the h1 lacks: this is the person's, not a
         workspace's (docs/UI-CHECKLIST.md §4.4). -->
    <PageHeading eyebrow="You" heading="Profile" />

    <PageNotice icon="i-lucide-construction" heading="Not built yet" :level="2">
      Your display name, password and picture will be edited here. Today a name is chosen when an account is created,
      and a password is changed with the reset link from the sign-in screen.
      <template #actions>
        <UButton to="/forgot-password" variant="outline" color="neutral" icon="i-lucide-key-round">Reset password</UButton>
      </template>
    </PageNotice>
  </AppShell>
</template>
