import { UApp } from '#components';
import type { MentionCandidate, MentionState, SlashState } from '@deep-wiki/editor';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { MENU_WIDTH_ESTIMATE } from '~/utils/menu-position';
import EditorSurface from './EditorSurface.vue';
import editorSurfaceSource from './EditorSurface.vue?raw';

/**
 * EditorSurface renders three things nothing else in this app renders: the
 * mention menu, the slash menu, and the `aria-activedescendant` wire between
 * the focused editor and whichever option the arrow keys currently sit on
 * (document-editor spec: "Mention And Slash Menus Are Keyboard-First",
 * "Empty And No-Results States", "Menus Reposition To Stay In The Viewport").
 *
 * The real `createEditorView` needs a browser: `EditorView` measures layout,
 * owns a contenteditable and reads `Range`/`Selection` — none of which
 * happy-dom provides faithfully, and `coordsAtPos()` in particular can only
 * ever return zeroes here, which would make every positioning assertion
 * vacuous. So `"./mount"` is mocked at exactly one seam — the view factory —
 * and everything else in that module stays real: the state the menus render
 * is produced by the shipped `reduceMentionState`/`reduceSlashState`, the
 * slash commands are the shipped `SLASH_COMMANDS`, and selection movement
 * wraps through the shipped `moveSelection`. What the fake supplies is only
 * what a real browser would: caret coordinates, and keydown events reaching
 * the plugin's key handling.
 *
 * The import is deliberately inside `vi.mock`'s factory rather than at the
 * top of the file: `scripts/checks/bundle-isolation.ts` forbids ANY file
 * under `apps/web` from statically importing `@deep-wiki/editor/mount`.
 */

type MentionAction =
  | { readonly type: 'trigger'; readonly from: number; readonly to: number; readonly query: string }
  | { readonly type: 'setCandidates'; readonly candidates: readonly MentionCandidate[] }
  | { readonly type: 'moveSelection'; readonly delta: number }
  | { readonly type: 'dismiss' };

type SlashAction =
  | { readonly type: 'trigger'; readonly from: number; readonly to: number; readonly query: string }
  | { readonly type: 'moveSelection'; readonly delta: number }
  | { readonly type: 'dismiss' };

interface FakeViewOptions {
  readonly dom: HTMLElement;
  /** The document the host parsed — with the converter it took from the mount module. */
  readonly doc: { textContent: string };
  readonly mention?: { readonly onStateChange?: (state: MentionState, view: unknown) => void; readonly onConfirmed?: (candidate: MentionCandidate) => void };
  readonly slash?: { readonly onStateChange?: (state: SlashState) => void };
}

const { harness } = vi.hoisted(() => ({
  harness: {
    /** What the fake view's `coordsAtPos()` reports — set by a test before it opens a menu. */
    caret: { top: 100, bottom: 120, left: 40 },
    /** Flipped once the component has finished its dynamic import and built its (fake) view. */
    mounted: false,
    /** The document the fake view was created with — what `fromMarkdown` produced from the `markdown` prop. */
    doc: null as null | { textContent: string },
    /** Resolved before `loadEditorMount()` hands the module to the component; a test holds it to see the surface before the view exists. */
    gate: Promise.resolve(),
    dispatchMention: (_action: MentionAction): void => {
      throw new Error('no editor mounted');
    },
    dispatchSlash: (_action: SlashAction): void => {
      throw new Error('no editor mounted');
    },
    /** What the host asked the editor to insert on a click — the fake `insertMention` / `confirmSlashCommand` record it here instead of touching a document. */
    confirmed: null as null | { readonly kind: 'mention'; readonly label: string } | { readonly kind: 'slash'; readonly id: string },
    /** How many times the host asked the (fake) view to take focus back. */
    focusCalls: 0,
  },
}));

vi.mock('@deep-wiki/editor/mount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deep-wiki/editor/mount')>();

  return {
    ...actual,
    // The two confirm paths the host wires for a click. The real ones build
    // ProseMirror transactions against a real document; here they record
    // what was confirmed and hand back a `tr`-shaped object whose `setMeta`
    // the fake `dispatch` below understands, so the dismiss still closes
    // the menu through the shipped reducer.
    insertMention(candidate: MentionCandidate, _range: unknown, tr: { setMeta: (key: unknown, action: unknown) => unknown }) {
      harness.confirmed = { kind: 'mention', label: candidate.label };
      return tr;
    },
    confirmSlashCommand(state: { tr: { setMeta: (key: unknown, action: unknown) => unknown } }, command: { id: string }) {
      harness.confirmed = { kind: 'slash', id: command.id };
      return state.tr.setMeta(actual.slashPluginKey, { type: 'dismiss' });
    },
    createEditorView(options: FakeViewOptions) {
      let mention = actual.INACTIVE_MENTION_STATE;
      let slash = actual.INACTIVE_SLASH_STATE;

      const view = {
        dom: options.dom,
        coordsAtPos: () => harness.caret,
        state: {
          get tr() {
            return { setMeta: (key: unknown, action: unknown) => ({ key, action }) };
          },
        },
        dispatch(tr: { key: unknown; action: MentionAction | SlashAction }) {
          if (tr.key === actual.mentionPluginKey) applyMention(tr.action as MentionAction);
          else applySlash(tr.action as SlashAction);
        },
        focus: () => {
          harness.focusCalls += 1;
        },
        destroy: () => {},
      };

      function applyMention(action: MentionAction): void {
        mention = actual.reduceMentionState(mention, action as never);
        options.mention?.onStateChange?.(mention, view);
      }

      function applySlash(action: SlashAction): void {
        slash = actual.reduceSlashState(slash, action as never);
        options.slash?.onStateChange?.(slash);
      }

      // Mirrors the two plugins' own `handleKeyDown` (mention-plugin.ts,
      // slash-plugin.ts): only the key-to-action mapping is restated here;
      // what the action then does is the shipped reducer's business.
      options.dom.addEventListener('keydown', (event) => {
        const dispatchAction = mention.active ? applyMention : slash.active ? applySlash : null;
        if (!dispatchAction) return;
        if (event.key === 'ArrowDown') dispatchAction({ type: 'moveSelection', delta: 1 });
        else if (event.key === 'ArrowUp') dispatchAction({ type: 'moveSelection', delta: -1 });
        else if (event.key === 'Escape') dispatchAction({ type: 'dismiss' });
      });

      harness.dispatchMention = applyMention;
      harness.dispatchSlash = applySlash;
      harness.doc = options.doc;
      harness.mounted = true;
      return view;
    },
  };
});

// The component takes the chunk from the shared importer, never from an
// `import()` of its own (fix C, docs/TODO.md Findings 2026-09-16): the
// route and the read screen start that same import early. The importer
// stays real — it resolves through the `@deep-wiki/editor/mount` mock
// above — and only gains a gate a test can hold.
vi.mock('~/utils/editor-mount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/utils/editor-mount')>();
  return {
    ...actual,
    loadEditorMount: async () => {
      await harness.gate;
      return actual.loadEditorMount();
    },
  };
});

const { searchMock, checkAccessMock } = vi.hoisted(() => ({ searchMock: vi.fn(), checkAccessMock: vi.fn() }));

mockNuxtImport('useMentionCandidates', () => () => ({ search: searchMock, checkAccess: checkAccessMock }));

const PEOPLE: MentionCandidate[] = [
  { id: 'u1', type: 'user', label: 'Ada Lovelace' },
  { id: 'u2', type: 'user', label: 'Alan Turing' },
  { id: 'p1', type: 'page', label: 'Architecture' },
];

const SurfaceInApp = defineComponent({
  name: 'SurfaceInApp',
  setup: () => () => h(UApp, null, { default: () => h(EditorSurface, { markdown: '# Hi\n', workspaceId: 'ws-1', pageId: 'page-1' }) }),
});

async function mountSurface() {
  harness.mounted = false;
  const component = await mountSuspended(SurfaceInApp);
  // The component only builds its view after `await import(…)` resolves, and
  // the first such import in a run pays for transforming the whole editor
  // module graph — seconds, not a microtask.
  await vi.waitFor(() => expect(harness.mounted).toBe(true), { timeout: 30_000 });
  return component;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Opens the `@` menu the way the plugin does, then lets the component's candidate fetch settle. */
async function openMentionMenu(query: string): Promise<void> {
  harness.dispatchMention({ type: 'trigger', from: 1, to: 1 + query.length + 1, query });
  await flush();
}

function openSlashMenu(query: string): void {
  harness.dispatchSlash({ type: 'trigger', from: 1, to: 1 + query.length + 1, query });
}

describe('EditorSurface', () => {
  beforeEach(() => {
    searchMock.mockReset();
    checkAccessMock.mockReset();
    searchMock.mockResolvedValue(PEOPLE);
    // The real `checkAccess` always returns a promise; a confirmed user
    // mention awaits it before deciding whether to warn.
    checkAccessMock.mockResolvedValue(true);
    harness.caret = { top: 100, bottom: 120, left: 40 };
    harness.confirmed = null;
    harness.focusCalls = 0;
    harness.doc = null;
    harness.gate = Promise.resolve();
  });

  /**
   * Fix C (docs/TODO.md Findings 2026-09-16, "edit-mode latency"): the
   * static `import { fromMarkdown, toMarkdown } from '@deep-wiki/editor'`
   * this component carried put the whole remark/micromark stack in the
   * edit route's pre-hydration chunk, although nothing needs a parser
   * before the session has arrived and the mount chunk has loaded. The
   * converters now come from the mount module, through the shared
   * importer the route and the read screen already started.
   */
  describe('the editor chunk and the converters', () => {
    test('parses the markdown prop with the converter from the mount module', async () => {
      await mountSurface();

      expect(harness.doc?.textContent).toBe('Hi');
    });

    test('carries no static value import of @deep-wiki/editor — only the type import survives', () => {
      const valueImports = [...editorSurfaceSource.matchAll(/^import\s+(?!type\b)[^;]*from\s+'@deep-wiki\/editor'/gm)];

      expect(valueImports.map((match) => match[0])).toEqual([]);
    });
  });

  /**
   * Fix H: measured on 2026-09-16, the surface's own box was in the DOM
   * 120–730 ms before ProseMirror attached to it — an empty 256px well
   * where the page's skeleton had just been. The skeleton's text lines
   * stay until the view exists; the surface is hidden, not absent, so the
   * element ProseMirror mounts into is there to mount into.
   */
  describe('until ProseMirror attaches', () => {
    test('shows the doc-body skeleton and hides the surface, then swaps them once the view exists', async () => {
      let open!: () => void;
      harness.gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      harness.mounted = false;
      const component = await mountSuspended(SurfaceInApp);

      expect(harness.mounted).toBe(false);
      expect(component.find('[data-testid="editor-skeleton"]').exists()).toBe(true);
      expect(component.get('[data-testid="editor-skeleton"]').attributes('aria-hidden')).toBe('true');
      // `v-show`: the element is there for ProseMirror to mount into, and
      // hidden. (VTU's `isVisible()` reads the layout tree happy-dom does
      // not have; the inline style is what `v-show` actually writes.)
      const surface = component.get('[data-testid="editor-surface"]');
      expect((surface.element as HTMLElement).style.display).toBe('none');

      open();
      await vi.waitFor(() => expect(harness.mounted).toBe(true), { timeout: 30_000 });
      await component.vm.$nextTick();

      expect(component.find('[data-testid="editor-skeleton"]').exists()).toBe(false);
      expect((surface.element as HTMLElement).style.display).not.toBe('none');
    });
  });

  /**
   * Measured by the 2026-09-14 audit: clicking the second candidate left
   * the text unchanged, the menu open and the editor unfocused. The
   * plugins handle Enter themselves and document the click as the host's
   * to wire (`mention-plugin.ts`: "confirmed (Enter or click)"); nothing
   * was wired. docs/UI-CHECKLIST.md §6, "no inert interactions".
   *
   * The click is dispatched on the option row itself — the element that
   * looks clickable — never on the listbox around it.
   */
  describe('a click confirms an option', () => {
    test('clicking the second mention candidate inserts that candidate, closes the menu and keeps the editor focused', async () => {
      const component = await mountSurface();
      await openMentionMenu('a');
      const second = component.findAll('[role="option"]')[1]!;

      // `mousedown` on something outside the contenteditable would move
      // focus off the editor before the click ever lands; the host has to
      // cancel it. This asserts the mechanism, since happy-dom does not
      // move focus for a real pointer.
      const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      second.element.dispatchEvent(mousedown);
      expect(mousedown.defaultPrevented).toBe(true);
      await second.trigger('click');

      expect(harness.confirmed).toEqual({ kind: 'mention', label: PEOPLE[1]!.label });
      expect(component.find('[role="listbox"]').exists()).toBe(false);
      expect(harness.focusCalls).toBeGreaterThan(0);
    });

    test('clicking the second slash command runs that command, not the one the arrow keys sat on', async () => {
      const component = await mountSurface();
      openSlashMenu('');
      await component.vm.$nextTick();
      const options = component.findAll('[role="option"]');
      const second = options[1]!;
      const secondId = second.attributes('id');
      expect(secondId).toBeTruthy();

      const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      second.element.dispatchEvent(mousedown);
      expect(mousedown.defaultPrevented).toBe(true);
      await second.trigger('click');

      expect(harness.confirmed?.kind).toBe('slash');
      // The second *rendered* command — whatever the shipped list orders
      // there — not index 0, which is where the selection still was.
      const secondLabel = second.text();
      const shipped = (await import('@deep-wiki/editor/mount')).SLASH_COMMANDS.find((command) => secondLabel.startsWith(command.label));
      expect(shipped).toBeDefined();
      expect(harness.confirmed).toEqual({ kind: 'slash', id: shipped!.id });
      expect(component.find('[role="listbox"]').exists()).toBe(false);
      expect(harness.focusCalls).toBeGreaterThan(0);
    });
  });

  /**
   * The editor is a contenteditable with no name and no relationship to
   * the menus it drives (audit, 2026-09-14; checklist §5). A combobox-style
   * chain needs: the editor named as a multiline textbox, `aria-haspopup`
   * saying what opens, `aria-controls` naming the open listbox, and the
   * listbox *owning* its options — with no `<ul>` of its own role in
   * between, or the options are orphans to assistive technology.
   */
  describe('ARIA ownership between the editor and its menus', () => {
    test('the editor is a named multiline textbox that declares its popup', async () => {
      const component = await mountSurface();
      const editor = component.get('[data-testid="editor-surface"]');

      expect(editor.attributes('role')).toBe('textbox');
      expect(editor.attributes('aria-multiline')).toBe('true');
      expect(editor.attributes('aria-label')).toBeTruthy();
      expect(editor.attributes('aria-haspopup')).toBe('listbox');
      expect(editor.attributes('aria-expanded')).toBe('false');
      expect(editor.attributes('aria-controls')).toBeUndefined();
    });

    test('while a menu is open, aria-controls names an element that exists, is the listbox, and owns the options', async () => {
      const component = await mountSurface();
      await openMentionMenu('a');
      const editor = component.get('[data-testid="editor-surface"]');

      expect(editor.attributes('aria-expanded')).toBe('true');
      const controlsId = editor.attributes('aria-controls');
      expect(controlsId).toBeTruthy();
      const listbox = component.get(`#${controlsId}`);
      expect(listbox.attributes('role')).toBe('listbox');

      // Every option's nearest ancestor with a role is the listbox itself:
      // an intervening `<ul>` must be `role="presentation"` (or absent).
      for (const option of listbox.findAll('[role="option"]')) {
        let node = option.element.parentElement;
        while (node && node !== listbox.element && (node.getAttribute('role') === null || node.getAttribute('role') === 'presentation')) {
          node = node.parentElement;
        }
        expect(node).toBe(listbox.element);
      }
    });

    test('the slash menu is wired the same way', async () => {
      const component = await mountSurface();
      openSlashMenu('');
      await component.vm.$nextTick();
      const editor = component.get('[data-testid="editor-surface"]');

      const controlsId = editor.attributes('aria-controls');
      expect(controlsId).toBeTruthy();
      expect(component.get(`#${controlsId}`).attributes('aria-label')).toBe('Block commands');
      expect(editor.attributes('aria-expanded')).toBe('true');
    });
  });

  describe('empty and no-results states', () => {
    test('the mention menu with nothing typed yet invites a query rather than rendering blank', async () => {
      searchMock.mockResolvedValue([]);
      const component = await mountSurface();

      await openMentionMenu('');

      const menu = component.get('[role="listbox"][aria-label="Mention suggestions"]');
      expect(menu.text()).toMatch(/type to search/i);
      expect(menu.findAll('[role="option"]')).toHaveLength(0);
    });

    test('a mention query that matches nobody shows a no-results state, not the empty-query invitation', async () => {
      searchMock.mockResolvedValue([]);
      const component = await mountSurface();

      await openMentionMenu('nobodyhere');

      const menu = component.get('[role="listbox"][aria-label="Mention suggestions"]');
      expect(menu.text()).toMatch(/no matches/i);
      expect(menu.text()).not.toMatch(/type to search/i);
      expect(menu.findAll('[role="option"]')).toHaveLength(0);
    });

    test('the mention menu drops its empty state as soon as candidates arrive', async () => {
      const component = await mountSurface();

      await openMentionMenu('a');

      const menu = component.get('[role="listbox"][aria-label="Mention suggestions"]');
      expect(menu.findAll('[role="option"]')).toHaveLength(PEOPLE.length);
      expect(menu.text()).not.toMatch(/no matches|type to search/i);
    });

    test('the slash menu with nothing typed yet lists its commands rather than claiming no matches', async () => {
      const component = await mountSurface();

      openSlashMenu('');
      await component.vm.$nextTick();

      const menu = component.get('[role="listbox"][aria-label="Block commands"]');
      // The state comes from the shipped `SLASH_COMMANDS`, so this asserts the
      // real command list is on screen — not merely that something rendered.
      expect(menu.findAll('[role="option"]').length).toBeGreaterThan(0);
      expect(menu.text()).toContain('Heading 1');
      expect(menu.text()).not.toMatch(/no matching commands/i);
    });

    test('a slash query that matches no command shows the no-results state', async () => {
      const component = await mountSurface();

      openSlashMenu('zzzz');
      await component.vm.$nextTick();

      const menu = component.get('[role="listbox"][aria-label="Block commands"]');
      expect(menu.text()).toMatch(/no matching commands/i);
      expect(menu.findAll('[role="option"]')).toHaveLength(0);
    });
  });

  describe('a candidate fetch that resolves out of order', () => {
    /**
     * `reduceMentionState`'s own comment says why the `trigger` reset
     * exists: "a query change invalidates the previous fetch's results …
     * the menu must not show stale candidates against a new query". The
     * reset only covers the moment the query changes. What happens *after*
     * it — a slower request for `@a` landing behind a faster one for `@ab`
     * — is the host's to guard, and `EditorSurface` is the host.
     */
    function deferred(): { promise: Promise<MentionCandidate[]>; resolve: (value: MentionCandidate[]) => void } {
      let resolve!: (value: MentionCandidate[]) => void;
      const promise = new Promise<MentionCandidate[]>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    }

    const ADA: MentionCandidate = { id: 'u1', type: 'user', label: 'Ada Lovelace' };
    const ALAN: MentionCandidate = { id: 'u2', type: 'user', label: 'Alan Turing' };

    test('the slow response for the query the user has moved past never repaints the menu', async () => {
      const first = deferred();
      const second = deferred();
      searchMock.mockImplementation((query: string) => (query === 'a' ? first.promise : second.promise));
      const component = await mountSurface();

      // The user types `@a`, then `@ab` before the first request answers.
      harness.dispatchMention({ type: 'trigger', from: 1, to: 3, query: 'a' });
      await flush();
      harness.dispatchMention({ type: 'trigger', from: 1, to: 4, query: 'ab' });
      await flush();
      expect(searchMock).toHaveBeenCalledTimes(2);

      // `@ab` answers first — that IS the current query, so it renders.
      second.resolve([ALAN]);
      await flush();
      // …and only then does the request for `@a` come back.
      first.resolve([ADA]);
      await flush();

      const menu = component.get('[role="listbox"][aria-label="Mention suggestions"]');
      const options = menu.findAll('[role="option"]');
      expect(options.map((option) => option.text())).toEqual(['Alan Turing']);
      expect(menu.text()).not.toContain('Ada Lovelace');
    });

    test('the same query typed again after a dismiss is fetched afresh, not suppressed by the guard', async () => {
      searchMock.mockResolvedValue([ADA]);
      const component = await mountSurface();

      await openMentionMenu('a');
      harness.dispatchMention({ type: 'dismiss' });
      await flush();
      await openMentionMenu('a');

      expect(searchMock).toHaveBeenCalledTimes(2);
      expect(component.get('[role="listbox"]').findAll('[role="option"]').map((option) => option.text())).toEqual(['Ada Lovelace']);
    });
  });

  describe('aria-activedescendant follows the highlighted option', () => {
    test('names an option that is actually in the document, and that option is the selected one', async () => {
      const component = await mountSurface();

      await openMentionMenu('a');

      const editor = component.get('[data-testid="editor-surface"]');
      const activeId = editor.attributes('aria-activedescendant');
      expect(activeId).toBeTruthy();
      const highlighted = component.get(`#${activeId}`);
      expect(highlighted.attributes('role')).toBe('option');
      expect(highlighted.attributes('aria-selected')).toBe('true');
      expect(highlighted.text()).toContain(PEOPLE[0]!.label);
    });

    test('the arrow keys move it down the mention list, one option at a time', async () => {
      const component = await mountSurface();
      await openMentionMenu('a');
      const editor = component.get('[data-testid="editor-surface"]');

      await editor.trigger('keydown', { key: 'ArrowDown' });

      let activeId = editor.attributes('aria-activedescendant')!;
      expect(component.get(`#${activeId}`).text()).toContain(PEOPLE[1]!.label);

      await editor.trigger('keydown', { key: 'ArrowDown' });

      activeId = editor.attributes('aria-activedescendant')!;
      expect(component.get(`#${activeId}`).text()).toContain(PEOPLE[2]!.label);
      expect(component.findAll('[aria-selected="true"]')).toHaveLength(1);
    });

    test('wrapping backwards past the first option still names an option that exists', async () => {
      const component = await mountSurface();
      await openMentionMenu('a');
      const editor = component.get('[data-testid="editor-surface"]');

      await editor.trigger('keydown', { key: 'ArrowUp' });

      const activeId = editor.attributes('aria-activedescendant')!;
      const highlighted = component.get(`#${activeId}`);
      expect(highlighted.text()).toContain(PEOPLE[PEOPLE.length - 1]!.label);
      expect(highlighted.attributes('aria-selected')).toBe('true');
    });

    test('the slash menu gets the same wiring', async () => {
      const component = await mountSurface();
      openSlashMenu('');
      await component.vm.$nextTick();
      const editor = component.get('[data-testid="editor-surface"]');

      await editor.trigger('keydown', { key: 'ArrowDown' });

      const activeId = editor.attributes('aria-activedescendant')!;
      const options = component.findAll('[role="option"]');
      const highlighted = component.get(`#${activeId}`);
      expect(highlighted.element).toBe(options[1]!.element);
      expect(highlighted.attributes('aria-selected')).toBe('true');
    });

    test('points at nothing while no menu is open', async () => {
      const component = await mountSurface();

      expect(component.get('[data-testid="editor-surface"]').attributes('aria-activedescendant')).toBeUndefined();
    });

    test('points at nothing when the open menu has no options to point at', async () => {
      searchMock.mockResolvedValue([]);
      const component = await mountSurface();

      await openMentionMenu('nobodyhere');

      expect(component.find('[role="listbox"]').exists()).toBe(true);
      expect(component.get('[data-testid="editor-surface"]').attributes('aria-activedescendant')).toBeUndefined();
    });

    test('stops pointing at an option once the menu is dismissed', async () => {
      const component = await mountSurface();
      await openMentionMenu('a');
      const editor = component.get('[data-testid="editor-surface"]');
      expect(editor.attributes('aria-activedescendant')).toBeTruthy();

      await editor.trigger('keydown', { key: 'Escape' });

      expect(editor.attributes('aria-activedescendant')).toBeUndefined();
      expect(component.find('[role="listbox"]').exists()).toBe(false);
    });
  });

  describe('menus stay inside the viewport', () => {
    /** The menus are `position: fixed`, so their inline `top`/`left` are viewport coordinates. */
    function menuBox(component: { get: (selector: string) => { element: Element } }, selector: string) {
      const style = (component.get(selector).element as HTMLElement).style;
      return { top: Number.parseFloat(style.top), left: Number.parseFloat(style.left) };
    }

    test('a mention menu with room below the caret opens below it', async () => {
      harness.caret = { top: 100, bottom: 120, left: 40 };
      const component = await mountSurface();

      await openMentionMenu('a');

      expect(menuBox(component, '[aria-label="Mention suggestions"]').top).toBeGreaterThanOrEqual(120);
    });

    test('a mention menu opened near the bottom edge renders above the caret instead of off-screen', async () => {
      harness.caret = { top: window.innerHeight - 40, bottom: window.innerHeight - 20, left: 40 };
      const component = await mountSurface();

      await openMentionMenu('a');

      const box = menuBox(component, '[aria-label="Mention suggestions"]');
      expect(box.top).toBeLessThan(harness.caret.top);
      expect(box.top).toBeGreaterThanOrEqual(0);
    });

    test('a slash menu opened near the bottom edge repositions too', async () => {
      harness.caret = { top: window.innerHeight - 40, bottom: window.innerHeight - 20, left: 40 };
      const component = await mountSurface();

      openSlashMenu('');
      await component.vm.$nextTick();

      const box = menuBox(component, '[aria-label="Block commands"]');
      expect(box.top).toBeLessThan(harness.caret.top);
      expect(box.top).toBeGreaterThanOrEqual(0);
    });

    test('a caret hard against the right edge pulls the menu back inside the viewport', async () => {
      harness.caret = { top: 100, bottom: 120, left: window.innerWidth - 10 };
      const component = await mountSurface();

      await openMentionMenu('a');

      const box = menuBox(component, '[aria-label="Mention suggestions"]');
      expect(box.left + MENU_WIDTH_ESTIMATE).toBeLessThanOrEqual(window.innerWidth);
      expect(box.left).toBeGreaterThanOrEqual(0);
    });
  });
});
