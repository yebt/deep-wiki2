<script setup lang="ts">
/**
 * The sidebar's management region — what stands in the pane when the
 * screen beside it is a settings area rather than a document.
 *
 * The owner's words (2026-09-16): "in a settings area the sidebar should
 * switch to everything that is management, not stay on the tree". So the
 * tree steps out and this steps in, and the pane's header — the
 * switcher, which names the room — stays where it is in both modes: the
 * person is still *in* the workspace, and a second copy of its name 40px
 * below the first would be the eyebrow defect of docs/UI-CHECKLIST.md
 * §4.4. The first thing here is therefore the way back, then the doors.
 *
 * **Grouped by whose the setting is**, which is M3's navigation-drawer
 * pattern (docs/DESIGN-SYSTEM.md §9.2 — section headline, items, a
 * separator between sections) and the split the product itself makes:
 *
 * - **Workspace** — this workspace's: Members (built), Settings and
 *   AI & models (placeholders, see below).
 * - **Instance** — the deployment's: Registration settings, which is the
 *   Super Root's. It renders for every caller, the same way the sidebar's
 *   footer door did before it, because no response the client holds
 *   carries `is_super_root` — no `capabilities` field, no `GET /me`
 *   (docs/TODO.md Open Questions, 2026-09-14). The destination refuses
 *   with a plain denied state; a link that might be refused is honest,
 *   a link hidden on a guess is not.
 * - **You** — the person's own: Profile (placeholder).
 *
 * **Placeholders are real routes, not disabled items.** Each unbuilt door
 * opens a screen that says so in the product's words and offers what
 * exists today instead (§3, "never a dead end"). The alternative — a
 * disabled item with its reason on hover — was rejected on a measured
 * ground, not taste: `UNavigationMenu`'s `disabled` renders the link with
 * `tabindex="-1"`, which removes it from the tab order and puts its reason
 * behind a hover a keyboard user cannot perform, the exact §5 failure the
 * checklist names. A route the person can reach and read is the honest
 * shape of "not built yet".
 *
 * `UNavigationMenu` is the library's drawer list (§4.1: no hand-rolled
 * equivalent): one tab stop per door, `aria-current="page"` on the one
 * whose screen is open — `exact`, so the dashboard's "Back to workspace"
 * is not marked current on every screen under `/w/<slug>/` — and a
 * `before:` state layer on hover and focus. Two things the library gets
 * wrong on this pane are corrected in `app.config.ts`, centrally: its
 * active fill is `bg-elevated`, the pane's own rung and therefore
 * invisible here (§5.2, "a state is a layer, never a step to another
 * surface rung"), and is replaced by `secondary-container`, M3's
 * selected-state role and the same fill the tree gives its selected row;
 * and its hover steps the same rung, replaced by a `currentColor` layer.
 *
 * The section headline is `title-small` on `on-surface-variant` (§9.2) —
 * rendered through the item's slot, on an element of this component's
 * own, because a project `--text-*` role written into a `:ui` slot
 * override is read by tailwind-merge as a colour and dropped against the
 * neighbouring `text-muted` (recorded in `app.config.ts` on
 * `authForm.description`).
 */
import type { NavigationMenuItem } from '@nuxt/ui';
import { accountUrl, aiUrl, membersUrl, registrationSettingsUrl, settingsUrl, workspaceUrl } from '~/utils/routes';

const props = defineProps<{
  /** The workspace whose doors these are, by the slug its addresses carry. */
  workspaceSlug: string;
}>();

/** A section headline — a labelled row that is not a door — rendered through the `section` slot so its type role is this component's own. */
interface Section extends NavigationMenuItem {
  type: 'label';
  slot: 'section';
}

function section(label: string): Section {
  return { label, type: 'label', slot: 'section' };
}

const items = computed<(NavigationMenuItem | Section)[][]>(() => {
  const slug = props.workspaceSlug;
  return [
    [{ label: 'Back to workspace', icon: 'i-lucide-arrow-left', to: workspaceUrl(slug), exact: true }],
    [
      section('Workspace'),
      { label: 'Members', icon: 'i-lucide-users', to: membersUrl(slug), exact: true },
      { label: 'Settings', icon: 'i-lucide-settings-2', to: settingsUrl(slug), exact: true },
      { label: 'AI & models', icon: 'i-lucide-sparkles', to: aiUrl(slug), exact: true },
    ],
    [section('Instance'), { label: 'Registration settings', icon: 'i-lucide-shield', to: registrationSettingsUrl(), exact: true }],
    [section('You'), { label: 'Profile', icon: 'i-lucide-user', to: accountUrl(), exact: true }],
  ];
});
</script>

<template>
  <UNavigationMenu orientation="vertical" color="neutral" :items="items" aria-label="Management" data-testid="management-sidebar">
    <template #section="{ item }">
      <span class="text-title-small text-muted">{{ item.label }}</span>
    </template>
  </UNavigationMenu>
</template>
