<script setup lang="ts">
/**
 * `/workspaces/:id/ai` — the workspace's AI providers and models. Not
 * built yet, and this screen says so.
 *
 * The API side exists (`ai-provider-foundation`: encrypted provider
 * credentials, the model registry, the usage ledger); no screen reaches
 * it yet, and PRODUCT.md lists "any AI or MCP surface" under "Not yet".
 * The door is in the management sidebar so the shape of management is
 * visible; it opens onto an honest state rather than being disabled, for
 * the reason recorded on `settings.vue` (a disabled item leaves the tab
 * order, docs/UI-CHECKLIST.md §5).
 */
import { workspaceUrl } from '~/utils/routes';

definePageMeta({ layout: 'workspace', sidebar: 'management' });

const route = useRoute();
// The address names the workspace by its slug; nothing here asks the API,
// so the frame resolves the id from the directory it already holds.
const workspaceSlug = route.params.workspace as string;

useSeoMeta({ title: 'AI & models — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="null" title="AI & models">
    <PageHeading heading="AI & models" />

    <PageNotice icon="i-lucide-construction" heading="Not built yet" :level="2">
      Provider keys, the models this workspace may use and what they cost will be set here. Nothing about AI can be
      configured from the browser yet, and no AI feature is switched on for this workspace.
      <template #actions>
        <UButton :to="workspaceUrl(workspaceSlug)" variant="outline" color="neutral" icon="i-lucide-arrow-left">Back to workspace</UButton>
      </template>
    </PageNotice>
  </AppShell>
</template>
