import { UApp } from '#components';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import { computed, defineComponent, h, ref, type VNode } from 'vue';
import AppShell from './AppShell.vue';
import SidebarToggle from './SidebarToggle.vue';
import WorkspaceFrame from './WorkspaceFrame.vue';
import WorkspaceSidebar from './WorkspaceSidebar.vue';

const { useWorkspaceTreeMock, useWorkspaceDirectoryMock } = vi.hoisted(() => ({
  useWorkspaceTreeMock: vi.fn(),
  useWorkspaceDirectoryMock: vi.fn(),
}));
mockNuxtImport('useWorkspaceTree', () => useWorkspaceTreeMock);
mockNuxtImport('useWorkspaceDirectory', () => useWorkspaceDirectoryMock);

const PATH = [
  { id: 'shelf-1', type: 'shelf', slug: 's', title: 'Engineering', position: 0, children: [] },
  { id: 'book-1', type: 'book', slug: 'b', title: 'Handbook', position: 0, children: [] },
  { id: 'page-1', type: 'page', slug: 'p', title: 'Onboarding', position: 0, children: [] },
];

function mockFrameCollaborators() {
  useWorkspaceTreeMock.mockReturnValue({
    status: ref('success'),
    nodes: ref([]),
    rootId: ref('root-1'),
    message: ref(''),
    collapsedIds: computed(() => new Set<string>()),
    selectedId: ref(null),
    load: vi.fn(async () => {}),
    reorder: vi.fn(async () => true),
    toggleCollapsed: vi.fn(),
    reveal: vi.fn(),
    pathTo: (id: string) => (id === 'page-1' ? PATH : []),
  });
  useWorkspaceDirectoryMock.mockReturnValue({
    status: ref('success'),
    workspaces: computed(() => [{ id: 'ws-1', name: 'Acme', slug: 'acme' }]),
    ensure: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    nameOf: (id: string) => (id === 'ws-1' ? 'Acme' : null),
  });
}
mockFrameCollaborators();

/**
 * `AppShell` owns two things no screen may restate: the chrome (the
 * full-height column, the app bar, the footer) and the content column's
 * width *and horizontal position*.
 *
 * The second is the one with a history. Measured on the running app at
 * 1280x900 on 2026-09-07, the read, edit and navigation-tree screens each
 * rendered a 658.9px column at **x=32** — `max-w-measure` caps a width and
 * centres nothing, so the right 589px of every product screen was empty
 * (docs/UI-CHECKLIST.md §6; docs/DESIGN-SYSTEM.md §2.4, "a measure is a
 * cap, not a position"). The suite was green throughout, because nothing
 * asserted the column at all.
 *
 * A unit test cannot measure a rendered box — happy-dom has no layout
 * engine, and the Review Log is explicit that the geometry belongs in
 * `e2e/auth-layout.spec.ts`. What it *can* hold is the half that was
 * missing when the defect shipped: that the column carries a horizontal
 * position at all, and that each of the three kinds resolves to the width
 * §2.4's table gives it. `mx-auto` disappearing from this file is exactly
 * the regression, and it now costs a red test rather than a review.
 */
function mountInApp(render: () => VNode) {
  return mountSuspended(
    defineComponent({
      name: 'ShellInApp',
      setup: () => () => h(UApp, null, { default: render }),
    }),
  );
}

const SLOT = { 'data-testid': 'shell-slot' } as const;

function mountShell(props: Record<string, unknown> = {}, headerEnd?: () => VNode) {
  return mountInApp(() =>
    h(AppShell, props, {
      default: () => h('p', SLOT, 'screen content'),
      ...(headerEnd ? { 'header-end': headerEnd } : {}),
    }),
  );
}

/** The element the slot's content sits directly inside — the shell's column. */
function columnOf(component: Awaited<ReturnType<typeof mountShell>>): HTMLElement {
  const slot = component.get('[data-testid="shell-slot"]').element;
  return slot.parentElement as HTMLElement;
}

describe('AppShell', () => {
  /*
   * The workspace frame: sidebar, content pane, contextual top bar. Chosen
   * by the screen naming a workspace — a string, or `null` while it is
   * still learning which — and never by a screen that names none.
   */
  describe('the workspace frame', () => {
    test('a screen inside a workspace gets the sidebar and the contextual bar, not the global app bar or the footer', async () => {
      const component = await mountShell({ workspaceId: 'ws-1' });

      const sidebar = component.findComponent(WorkspaceSidebar);
      expect(sidebar.exists()).toBe(true);
      expect(sidebar.props('workspaceId')).toBe('ws-1');
      expect(component.findAll('footer')).toHaveLength(0);
      expect(component.find('header a[href="/"]').exists()).toBe(false);
      // Still exactly one main landmark, and the column stands in it.
      expect(component.findAll('main')).toHaveLength(1);
      expect(component.get('main').element.contains(columnOf(component))).toBe(true);
    });

    test('a screen that names no workspace keeps the document frame', async () => {
      const component = await mountShell();

      expect(component.findComponent(WorkspaceSidebar).exists()).toBe(false);
      expect(component.findAll('footer')).toHaveLength(1);
    });

    test('the breadcrumb walks workspace › shelf › book › chapter › page, linking the workspace and the page only', async () => {
      const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1' });

      const nav = component.get('nav[aria-label="Where you are"]');
      const labels = nav.findAll('li').map((li) => li.text()).filter((text) => text.length > 0);
      expect(labels).toEqual(['Acme', 'Engineering', 'Handbook', 'Onboarding']);
      expect(nav.get('a[href="/workspaces/ws-1"]').text()).toBe('Acme');
      expect(nav.get('a[href="/pages/page-1"]').text()).toBe('Onboarding');
      expect(nav.find('a[href*="shelf-1"]').exists()).toBe(false);
    });

    test('a trail extends the breadcrumb past the node, and a title stands in when the tree cannot place it', async () => {
      const withTrail = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1', trail: [{ label: 'History' }] });
      const trailLabels = withTrail.get('nav[aria-label="Where you are"]').findAll('li').map((li) => li.text()).filter(Boolean);
      expect(trailLabels).toEqual(['Acme', 'Engineering', 'Handbook', 'Onboarding', 'History']);

      const withTitle = await mountShell({ workspaceId: 'ws-1', nodeId: 'unplaced', title: 'Members' });
      const titleLabels = withTitle.get('nav[aria-label="Where you are"]').findAll('li').map((li) => li.text()).filter(Boolean);
      expect(titleLabels).toEqual(['Acme', 'Members']);
    });

    /*
     * The condensed bar (2026-09-16), for a screen where the document must
     * outrank the chrome — edit mode. The owner: "the top part is too much;
     * the document loses importance." The breadcrumb keeps its last two
     * crumbs and folds the rest into one overflow control that reveals them
     * (PRODUCT.md principle 1: the tree beside it is the furniture; the
     * path is one activation away, not a line of chrome).
     */
    describe('condensed', () => {
      test('the breadcrumb shows the last two crumbs behind an overflow control that names itself', async () => {
        const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1', trail: [{ label: 'Editing' }], condensed: true });

        const nav = component.get('nav[aria-label="Where you are"]');
        const labels = nav.findAll('li').map((li) => li.text()).filter(Boolean);
        expect(labels).toEqual(['Onboarding', 'Editing']);
        const overflow = nav.get('button[aria-label="Show the full path"]');
        expect(overflow.text()).toBe('');
        // The overflow stands where the folded crumbs stood: first.
        const html = nav.element.innerHTML;
        expect(html.indexOf('Show the full path')).toBeLessThan(html.indexOf('Onboarding'));
        // Nothing folded is drawn as a crumb; the workspace link is in the menu, not the row.
        expect(nav.find('a[href="/workspaces/ws-1"]').exists()).toBe(false);
        expect(nav.get('a[href="/pages/page-1"]').text()).toBe('Onboarding');
      });

      test('the overflow control is a menu holding the folded crumbs in order, the workspace as a link and the places as names', async () => {
        const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1', trail: [{ label: 'Editing' }], condensed: true });

        // The sidebar's switcher is a dropdown too; the overflow is the one inside the breadcrumb.
        const nav = component.get('nav[aria-label="Where you are"]').element;
        const menu = component.findAllComponents({ name: 'UDropdownMenu' }).find((candidate) => nav.contains(candidate.element));
        expect(menu).toBeDefined();
        const items = (menu!.props('items') as { label: string; to?: string; type?: string }[][]).flat();
        expect(items.map((item) => item.label)).toEqual(['Acme', 'Engineering', 'Handbook']);
        expect(items[0]).toMatchObject({ to: '/workspaces/ws-1' });
        expect(items[1]?.to).toBeUndefined();
        expect(items[2]?.to).toBeUndefined();
      });

      test('below sm the overflow control is gone outright, never a focusable control that cannot be seen', async () => {
        const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1', trail: [{ label: 'Editing' }], condensed: true });

        const overflowItem = component.get('nav[aria-label="Where you are"] button[aria-label="Show the full path"]').element.closest('[data-slot="item"]')!;
        expect(overflowItem.className).toMatch(/\bmax-sm:hidden\b/);
      });

      test('a path of two crumbs or fewer has nothing to fold and shows no overflow control', async () => {
        const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'unplaced', title: 'Members', condensed: true });

        const nav = component.get('nav[aria-label="Where you are"]');
        expect(nav.findAll('li').map((li) => li.text()).filter(Boolean)).toEqual(['Acme', 'Members']);
        expect(nav.find('button[aria-label="Show the full path"]').exists()).toBe(false);
      });

      test('the bar keeps the header height the full bar has, so the column below starts where it does on every other screen', async () => {
        const full = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1' });
        const condensed = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1', trail: [{ label: 'Editing' }], condensed: true });

        expect(condensed.get('#content-bar').classes()).toEqual(full.get('#content-bar').classes());
      });
    });

    // Focus mode's control stands at the sidebar's edge of the bar — before
    // the breadcrumb, where the drawer's own toggle stands below `lg` — on
    // every screen inside a workspace, in either frame mode.
    test('the contextual bar opens with the sidebar toggle, before the breadcrumb', async () => {
      const component = await mountShell({ workspaceId: 'ws-1' });

      const toggle = component.findComponent(SidebarToggle);
      expect(toggle.exists()).toBe(true);
      const bar = component.get('#content-bar').element;
      expect(bar.contains(toggle.element)).toBe(true);
      const html = bar.innerHTML;
      expect(html.indexOf('aria-label="Hide sidebar"')).toBeLessThan(html.indexOf('aria-label="Where you are"'));
    });

    // At 320 the bar holds the drawer toggle, up to four controls and the
    // breadcrumb; measured on 2026-09-15 the workspace crumb rendered as
    // "E." — clipped text (§6). Below `sm` only the last crumb is shown;
    // the rest stay for assistive technology, and the workspace is one tap
    // away in the drawer. What this holds is the classes; the 320 shot in
    // the review material is what shows it.
    test('below sm the breadcrumb shows the last crumb only, keeping the rest for screen readers', async () => {
      const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1' });

      const items = component.get('nav[aria-label="Where you are"]').findAll('[data-slot="item"]');
      expect(items.length).toBeGreaterThan(1);
      for (const item of items) expect(item.classes()).toEqual(expect.arrayContaining(['max-sm:sr-only', 'max-sm:last:not-sr-only']));
      for (const separator of component.get('nav[aria-label="Where you are"]').findAll('[data-slot="separator"]')) {
        expect(separator.classes()).toContain('max-sm:hidden');
      }
    });

    test('`header-end` is the contextual bar’s action area, beside the breadcrumb', async () => {
      const component = await mountShell({ workspaceId: 'ws-1' }, () => h('button', { type: 'button' }, 'Edit'));

      // The breadcrumb is itself a `data-slot="root"`; the bar is the next one up.
      const bar = component.get('nav[aria-label="Where you are"]').element.parentElement!.closest('[data-slot="root"]')!;
      const edit = component.findAll('button').find((button) => button.text() === 'Edit')!;
      expect(bar.contains(edit.element)).toBe(true);
    });

    // The sidebar precedes the content in reading order, so without this a
    // keyboard user crosses the switcher, the toolbar, the tree and the
    // doors before reaching the screen's own actions (§5). Measured in
    // `e2e/history.spec.ts`: Skip, then breadcrumb → history → Edit.
    test('the frame’s first focusable element skips to the contextual bar, and the bar can take focus', async () => {
      const component = await mountShell({ workspaceId: 'ws-1' });

      const focusables = component.findAll('a, button, [tabindex="0"]');
      expect(focusables[0]!.text()).toBe('Skip to content');
      expect(focusables[0]!.attributes('href')).toBe('#content-bar');
      const bar = component.get('#content-bar');
      expect(bar.element.tagName).toBe('HEADER');
      expect(bar.attributes('tabindex')).toBe('-1');
    });

    /*
     * Inside `layouts/workspace.vue` the frame is already standing — mounted
     * once, so the sidebar survives navigations — and the shell renders
     * only what belongs to this screen: the contextual bar and the column.
     * A second frame here would be a second sidebar. The screen still hands
     * the frame the node it is about, which is how the tree marks the row.
     */
    test('inside the workspace layout, renders only the content pane and hands the frame its node', async () => {
      let frame!: ReturnType<typeof provideWorkspaceFrame>;
      const component = await mountInApp(() =>
        h(
          defineComponent({
            setup() {
              frame = provideWorkspaceFrame();
              return () => h(AppShell, { workspaceId: 'ws-1', nodeId: 'page-1' }, { default: () => h('p', SLOT, 'screen content') });
            },
          }),
        ),
      );

      expect(component.findComponent(WorkspaceFrame).exists()).toBe(false);
      expect(component.findComponent(WorkspaceSidebar).exists()).toBe(false);
      expect(component.find('#content-bar').exists()).toBe(true);
      expect(component.findAll('main')).toHaveLength(1);
      expect(frame.nodeId.value).toBe('page-1');
    });

    test('outside any layout, a screen inside a workspace stands up the whole frame itself — the same component the layout mounts', async () => {
      const component = await mountShell({ workspaceId: 'ws-1', nodeId: 'page-1' });

      const frame = component.findComponent(WorkspaceFrame);
      expect(frame.exists()).toBe(true);
      expect(frame.props('nodeId')).toBe('page-1');
      expect(frame.element.contains(component.get('#content-bar').element) || frame.findComponent(WorkspaceSidebar).exists()).toBe(true);
    });

    test('naming a workspace enters it, so the next screen that has not learned its own starts from this one', async () => {
      await mountShell({ workspaceId: 'ws-1' });
      const component = await mountShell({ workspaceId: null });

      expect(component.findComponent(WorkspaceSidebar).props('workspaceId')).toBe('ws-1');
    });
  });

  describe('the content column', () => {
    test('the measure column is centred, not merely capped', async () => {
      const component = await mountShell({ column: 'measure' });

      const column = columnOf(component);
      expect(column.className).toContain('max-w-measure');
      // The half that was missing when 589px of every wide screen went
      // unused: a maximum width with no horizontal position.
      expect(column.className).toContain('mx-auto');
    });

    test('the narrow column is centred too, and is the auth card width rather than the measure', async () => {
      const component = await mountShell({ column: 'narrow' });

      const column = columnOf(component);
      expect(column.className).toContain('max-w-md');
      expect(column.className).toContain('mx-auto');
      expect(column.className).not.toContain('max-w-measure');
    });

    test('the wide column states no maximum width, so the container’s own is what applies', async () => {
      const component = await mountShell({ column: 'wide' });

      const column = columnOf(component);
      expect(column.className).not.toMatch(/max-w-/);
    });

    test('a screen that names no column gets the reading measure', async () => {
      const component = await mountShell();

      expect(columnOf(component).className).toContain('max-w-measure');
    });

    test('the column stands inside the page’s one main landmark', async () => {
      const component = await mountShell();

      const main = component.get('main').element;
      expect(component.findAll('main')).toHaveLength(1);
      expect(main.contains(columnOf(component))).toBe(true);
    });

    /**
     * These two assert a **class**, not the effect it stands for, and the
     * distance between the two is real: `my-auto` centres nothing on its
     * own. An auto margin absorbs free space only inside a flex container
     * that has some, so a screen can carry every class this file names and
     * still render top-aligned. The test below holds the other half of the
     * mechanism; neither is the effect.
     *
     * **The effect is owned by `e2e/auth-layout.spec.ts` — "the sign-in
     * block is centred in the space between header and footer".** That is
     * the only test in this repository that can fail when the centring is
     * broken, because it measures the rendered box in a real browser.
     * happy-dom has no layout engine: every `getBoundingClientRect()` here
     * returns zeroes, so no assertion in this file can be strengthened into
     * proof of position. Do not read a green run here as one.
     */
    test('`center` absorbs the leftover vertical space, and is off unless asked for', async () => {
      const centred = await mountShell({ center: true });
      const topAligned = await mountShell();

      // `my-auto` sits on the container around the column: it only absorbs
      // *positive* free space, so a block taller than the region stays
      // top-aligned and fully reachable.
      expect(columnOf(centred).parentElement!.className).toContain('my-auto');
      expect(columnOf(topAligned).parentElement!.className).not.toContain('my-auto');
    });

    test('the main region is the flex column that gives `my-auto` free space to absorb', async () => {
      const component = await mountShell({ center: true });
      const main = component.get('main').element;

      // The half nothing asserted until now, and the half a reader looking
      // for a broken centring reaches for first: `my-auto` above is inert
      // unless `main` is a flex column that actually takes the height the
      // header and footer leave. `AppShell` states no class on `UMain` —
      // the base is replaced centrally in `app.config.ts`, because it is
      // only correct inside this column — so the two live in different
      // files and the seam between them is exactly what this holds.
      expect(main.className).toContain('flex');
      expect(main.className).toContain('flex-col');
      expect(main.className).toContain('flex-1');
      expect(main.className).toContain('min-h-0');
      // And `UMain`'s own base must be *gone*, not merely accompanied:
      // `min-h-[calc(100vh-var(--ui-header-height))]` is viewport minus the
      // header with no allowance for a footer, which is the 49px of
      // permanent scroll the 2026-09-04 review found on all four screens.
      expect(main.className).not.toContain('min-h-[calc(');
    });
  });

  describe('the chrome', () => {
    test('renders the three landmarks every screen shares, exactly once each', async () => {
      const component = await mountShell();

      expect(component.findAll('header')).toHaveLength(1);
      expect(component.findAll('main')).toHaveLength(1);
      expect(component.findAll('footer')).toHaveLength(1);
    });

    test('the brand is the way back from any screen, so it is a link and not a label', async () => {
      const component = await mountShell();

      const brand = component.get('header a[href="/"]');
      expect(brand.text()).toContain('deep-wiki');
    });

    test('the only icon-only controls in the chrome carry an accessible name', async () => {
      const component = await mountShell();

      const icons = [...component.findAll('header button'), ...component.findAll('header a')].filter(
        (el) => el.attributes('href') !== '/',
      );
      const named = icons.filter((el) => (el.text() || el.attributes('aria-label') || '').length > 0);
      expect(named).toHaveLength(icons.length);
      expect(named.some((el) => el.attributes('aria-label') === 'Toggle color theme')).toBe(true);
      expect(named.some((el) => el.attributes('aria-label') === 'Registration settings')).toBe(true);
    });

    /*
     * `/admin/registration` was reachable only by typing the URL
     * (docs/TODO.md). Nothing in any response the client already has —
     * not the login/session cookie exchange, not any workspace or tree
     * response — surfaces `is_super_root`, and there is no `GET
     * /me`-shaped endpoint to ask instead (confirmed by reading
     * `apps/api/src/routes/admin.ts`'s own `requireSuperRoot`, which
     * checks the users table directly and answers a non-operator with a
     * plain 403, never a client-visible flag). So this is a deliberate
     * fallback, not a permission check: the entry renders for every
     * caller, in the chrome every screen shares, and
     * `/admin/registration`'s own existing "This is the instance
     * operator's" state is what actually gates a non-operator.
     */
    test('offers a persistent entry point to registration settings, in the chrome every screen shares', async () => {
      const component = await mountShell();

      const link = component.get('header a[href="/admin/registration"]');
      expect(link.attributes('aria-label')).toBe('Registration settings');
    });

    test('the header renders no control that does nothing — no route mounts a mobile menu yet', async () => {
      const component = await mountShell();

      // `UHeader`'s default hamburger opens a menu built from its `#body`
      // slot, which nothing fills: a control that looks clickable and is
      // inert (docs/UI-CHECKLIST.md §6, observable breakage).
      expect(component.findAll('header button')).toHaveLength(1);
    });

    test('`header-end` puts a screen’s own chrome in the app bar, beside the shared theme toggle', async () => {
      const component = await mountShell({}, () => h('button', { type: 'button' }, 'Save'));

      const header = component.get('header').element;
      const save = component.get('header button');
      expect(save.text()).toBe('Save');
      expect(header.contains(save.element)).toBe(true);
      // Screen chrome first, then the toggle every screen shares.
      expect(component.findAll('header button')).toHaveLength(2);
      expect(component.findAll('header button')[1]!.attributes('aria-label')).toBe('Toggle color theme');
    });

    test('the screen’s content is not in the header or the footer', async () => {
      const component = await mountShell();

      const slot = component.get('[data-testid="shell-slot"]').element;
      expect(component.get('header').element.contains(slot)).toBe(false);
      expect(component.get('footer').element.contains(slot)).toBe(false);
    });
  });
});
