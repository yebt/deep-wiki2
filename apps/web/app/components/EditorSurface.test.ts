import { UApp } from '#components';
import type { MentionCandidate, MentionState, SlashState } from '@deep-wiki/editor';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { MENU_WIDTH_ESTIMATE } from '~/utils/menu-position';
import EditorSurface from './EditorSurface.vue';

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
  readonly mention?: { readonly onStateChange?: (state: MentionState, view: unknown) => void; readonly onConfirmed?: (candidate: MentionCandidate) => void };
  readonly slash?: { readonly onStateChange?: (state: SlashState) => void };
}

const { harness } = vi.hoisted(() => ({
  harness: {
    /** What the fake view's `coordsAtPos()` reports — set by a test before it opens a menu. */
    caret: { top: 100, bottom: 120, left: 40 },
    /** Flipped once the component has finished its dynamic import and built its (fake) view. */
    mounted: false,
    dispatchMention: (_action: MentionAction): void => {
      throw new Error('no editor mounted');
    },
    dispatchSlash: (_action: SlashAction): void => {
      throw new Error('no editor mounted');
    },
  },
}));

vi.mock('@deep-wiki/editor/mount', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deep-wiki/editor/mount')>();

  return {
    ...actual,
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
        focus: () => {},
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
      harness.mounted = true;
      return view;
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
    harness.caret = { top: 100, bottom: 120, left: 40 };
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
