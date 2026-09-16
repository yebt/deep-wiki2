import { UApp } from '#components';
import type { MentionCandidate, MentionState, SlashState } from '@deep-wiki/editor';
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { MENU_WIDTH_ESTIMATE, positionToolbar } from '~/utils/menu-position';
import EditorSelectionToolbar from './EditorSelectionToolbar.vue';
import EditorSurface from './EditorSurface.vue';
import editorSurfaceSource from './EditorSurface.vue?raw';

/**
 * EditorSurface renders three things nothing else in this app renders: the
 * mention menu, the slash menu, and the `aria-activedescendant` wire between
 * the focused editor and whichever option the arrow keys currently sit on
 * (document-editor spec: "Mention And Slash Menus Are Keyboard-First",
 * "Empty And No-Results States", "Menus Reposition To Stay In The Viewport").
 *
 * The real `mountEditor` needs a browser: `EditorView` measures layout,
 * owns a contenteditable and reads `Range`/`Selection` — none of which
 * happy-dom provides faithfully, and `coordsAtPos()` in particular can only
 * ever return zeroes here, which would make every positioning assertion
 * vacuous. So `"./mount"` is mocked at exactly one seam — the mount factory,
 * which returns the `EditorHandle` the component holds — and everything
 * else in that module stays real: the state the menus render is produced by
 * the shipped `reduceMentionState`/`reduceSlashState`, the slash commands
 * are the shipped `SLASH_COMMANDS`, and selection movement wraps through
 * the shipped `moveSelection`. What the fake supplies is only what a real
 * browser would: caret coordinates, keydown events reaching the plugin's
 * key handling, and a record of which handle command the host called.
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
  readonly onUpdate?: (view: unknown, update: EditorUpdate) => void;
  readonly selection?: { readonly onChange?: (report: SelectionReport) => void };
}

/** What the shipped selection plugin reports (`selection-plugin.ts`): the snapshot plus both ends' coordinates. */
interface SelectionReport {
  readonly kind: 'text' | 'code' | 'node' | 'gap';
  readonly from: number;
  readonly to: number;
  readonly empty: boolean;
  readonly marks: { strong: boolean; emphasis: boolean; delete: boolean; inlineCode: boolean; link: boolean };
  readonly link: { href: string; title: string | null } | null;
  readonly coords: { from: LineRect; to: LineRect } | null;
}
interface LineRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** What the shipped `describeUpdate` reports after a transaction (`editor-commands.ts`). */
interface EditorUpdate {
  readonly transactionCount: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
  readonly selection: { readonly kind: 'text'; readonly from: number; readonly to: number; readonly empty: boolean; readonly marks: Record<string, boolean>; readonly link: null };
}

/** A handle command the host called, by name and arguments. */
interface HandleCall {
  readonly command: string;
  readonly args: readonly unknown[];
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
    /** Reports a selection change to the host the way the shipped selection plugin does. */
    select: (_report: SelectionReport): void => {
      throw new Error('no editor mounted');
    },
    /** Gives the fake view a new document instance, as a transaction with steps would. */
    replaceDoc: (_markdown: string): void => {
      throw new Error('no editor mounted');
    },
    /** Reports a transaction to the host the way the real `dispatchTransaction` does, with these history depths. */
    update: (_depths: { undoDepth: number; redoDepth: number }): void => {
      throw new Error('no editor mounted');
    },
    /** What the host asked the editor to insert on a click — the fake `insertMention` / `confirmSlashCommand` record it here instead of touching a document. */
    confirmed: null as null | { readonly kind: 'mention'; readonly label: string } | { readonly kind: 'slash'; readonly id: string },
    /** How many times the host asked the (fake) view to take focus back. */
    focusCalls: 0,
    /** Every `EditorHandle` command the host called, in order. */
    handleCalls: [] as HandleCall[],
    /** What the fake handle's `blockAt` answers — the block under the pointer, or none. */
    blockHit: null as null | { pos: number; node: { type: { name: string }; attrs: Record<string, unknown>; firstChild: null }; rect: { left: number; top: number; right: number; bottom: number; width: number; height: number } },
    /** What each block command's dry run answers (`moveBlockUp(state)` with no dispatch). */
    dryRuns: { moveBlockUp: true, moveBlockDown: true, deleteBlock: true, duplicateBlock: true, turnInto: true },
    /** The document a `dispatch` of a selection landed on: what `placeCaretIn` asked for. */
    caretPlacedAt: null as null | number,
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
    // The block commands' dry runs (`command(state)` with no dispatch): the
    // real ones read a real `EditorState`, which the fake view has no room
    // for; the answers are the harness's, and the host's handling of them
    // is what is under test.
    moveBlockUp: () => harness.dryRuns.moveBlockUp,
    moveBlockDown: () => harness.dryRuns.moveBlockDown,
    deleteBlock: () => harness.dryRuns.deleteBlock,
    duplicateBlock: () => harness.dryRuns.duplicateBlock,
    turnInto: () => () => harness.dryRuns.turnInto,
    mountEditor(options: FakeViewOptions) {
      let mention = actual.INACTIVE_MENTION_STATE;
      let slash = actual.INACTIVE_SLASH_STATE;

      // The selection's class is how `placeCaretIn` reaches `Selection.near`
      // (`utils/block-tunes.ts`); this one answers with the position asked.
      class FakeSelection {
        from = 1;
        static near(resolved: { pos: number }) {
          return { placedAt: resolved.pos };
        }
      }
      const blockDom = document.createElement('p');
      const view = {
        dom: options.dom,
        coordsAtPos: () => harness.caret,
        nodeDOM: () => blockDom,
        state: {
          // The real document the host parsed, so the debounced `toMarkdown`
          // the host runs after an update has something to serialise; a
          // test swaps it (`harness.replaceDoc`) to stand for a transaction
          // with steps, which is the only kind that yields a new instance.
          doc: options.doc,
          selection: new FakeSelection(),
          get tr() {
            return {
              setMeta: (key: unknown, action: unknown) => ({ key, action }),
              setSelection: (selection: { placedAt: number }) => ({ selection }),
            };
          },
        },
        dispatch(tr: { key?: unknown; action?: MentionAction | SlashAction; selection?: { placedAt: number } }) {
          if (tr.selection) {
            harness.caretPlacedAt = tr.selection.placedAt;
            return;
          }
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

      harness.select = (report) => options.selection?.onChange?.(report);
      harness.replaceDoc = (markdown) => {
        view.state.doc = actual.fromMarkdown(markdown);
      };
      let transactionCount = 0;
      harness.update = ({ undoDepth, redoDepth }) => {
        transactionCount += 1;
        options.onUpdate?.(view, {
          transactionCount,
          undoDepth,
          redoDepth,
          selection: { kind: 'text', from: 1, to: 1, empty: true, marks: { strong: false, emphasis: false, delete: false, inlineCode: false, link: false }, link: null },
        });
      };
      harness.dispatchMention = applyMention;
      harness.dispatchSlash = applySlash;
      harness.doc = options.doc;
      harness.mounted = true;
      // The `EditorHandle`: the view plus the command surface bound to it.
      // Every command records the call and answers `true`, as the real one
      // does where it applies.
      const record = (command: string) => (...args: unknown[]) => {
        harness.handleCalls.push({ command, args });
        return true;
      };
      return {
        view,
        undo: record('undo'),
        redo: record('redo'),
        toggleMark: record('toggleMark'),
        setLink: record('setLink'),
        unsetLink: record('unsetLink'),
        moveBlockUp: record('moveBlockUp'),
        moveBlockDown: record('moveBlockDown'),
        deleteBlock: record('deleteBlock'),
        duplicateBlock: record('duplicateBlock'),
        turnInto: record('turnInto'),
        blockAt: () => harness.blockHit,
        startBlockDrag: record('startBlockDrag'),
        endBlockDrag: () => {
          harness.handleCalls.push({ command: 'endBlockDrag', args: [] });
        },
        destroy: () => {
          harness.handleCalls.push({ command: 'destroy', args: [] });
        },
      };
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

async function mountSurface(options: { attachTo?: Element } = {}) {
  harness.mounted = false;
  const component = await mountSuspended(SurfaceInApp, options);
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
    harness.handleCalls = [];
    harness.blockHit = null;
    harness.dryRuns = { moveBlockUp: true, moveBlockDown: true, deleteBlock: true, duplicateBlock: true, turnInto: true };
    harness.caretPlacedAt = null;
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

    // The handle, not the bare view: `mountEditor` returns the view plus
    // the command surface bound to it (undo/redo, the marks, the block
    // tunes, the drag hooks), which is what every control this component
    // renders acts through. It is torn down with the component.
    test('mounts through mountEditor and destroys the handle when it unmounts', async () => {
      const component = await mountSurface();
      expect(harness.handleCalls.map((call) => call.command)).not.toContain('destroy');

      component.unmount();

      expect(harness.handleCalls.map((call) => call.command)).toContain('destroy');
    });

    test('carries no static value import of @deep-wiki/editor — only the type import survives', () => {
      const valueImports = [...editorSurfaceSource.matchAll(/^import\s+(?!type\b)[^;]*from\s+'@deep-wiki\/editor'/gm)];

      expect(valueImports.map((match) => match[0])).toEqual([]);
    });
  });

  /**
   * Undo and redo live in the contextual bar (`pages/[id]/edit.vue`),
   * outside this component, so the bar needs two things from it: the
   * history depths after every transaction — read from the history
   * plugin's own counters by the shipped `describeUpdate`, never inferred
   * from keystrokes — and the two commands, which run through the handle
   * so the button and `Ctrl+Z` can never disagree.
   */
  describe('what a transaction reports', () => {
    /**
     * A selection-only transaction — a click, an arrow key — keeps
     * `state.doc` the same instance and must not report the document:
     * doing so marked the buffer dirty and enabled Save before anything
     * had changed, and `e2e/editor.spec.ts` saved the pre-edit document
     * when a click landed inside the 300ms window (docs/TODO.md,
     * 2026-09-16).
     */
    test('a transaction that left the document alone reports no update; one that changed it reports the new markdown once', async () => {
      vi.useFakeTimers();
      try {
        const component = await mountSurface();
        const surface = component.findComponent(EditorSurface);

        harness.update({ undoDepth: 0, redoDepth: 0 });
        harness.update({ undoDepth: 0, redoDepth: 0 });
        await vi.advanceTimersByTimeAsync(400);
        expect(surface.emitted('update')).toBeUndefined();

        harness.replaceDoc('# Hi\n\nChanged.\n');
        harness.update({ undoDepth: 1, redoDepth: 0 });
        harness.update({ undoDepth: 1, redoDepth: 0 });
        await vi.advanceTimersByTimeAsync(400);
        expect(surface.emitted('update')).toEqual([['# Hi\n\nChanged.\n']]);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('flush', () => {
    /**
     * Save reads the buffer the surface last reported, and the surface
     * reports 300ms after the last transaction — so a Save inside that
     * window saved the document before the edit (docs/TODO.md, "a dirty
     * editor has a 300ms blind spot"). `flush()` reports what is pending
     * now; the screen calls it before it saves.
     */
    test('reports a pending document at once, and reports nothing when nothing is pending', async () => {
      vi.useFakeTimers();
      try {
        const component = await mountSurface();
        const surface = component.findComponent(EditorSurface);
        const flush = (surface.vm as unknown as { flush: () => void }).flush;

        flush();
        expect(surface.emitted('update')).toBeUndefined();

        harness.replaceDoc('# Hi\n\nPending.\n');
        harness.update({ undoDepth: 1, redoDepth: 0 });
        flush();
        expect(surface.emitted('update')).toEqual([['# Hi\n\nPending.\n']]);

        // The timer was cleared with it: nothing reports twice.
        await vi.advanceTimersByTimeAsync(400);
        expect(surface.emitted('update')).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('undo and redo for the contextual bar', () => {
    test('reports the history depths of every transaction, undebounced, as a `history` event', async () => {
      const component = await mountSurface();
      const surface = component.findComponent(EditorSurface);

      harness.update({ undoDepth: 1, redoDepth: 0 });
      harness.update({ undoDepth: 2, redoDepth: 0 });
      harness.update({ undoDepth: 1, redoDepth: 1 });

      expect(surface.emitted('history')).toEqual([[{ undoDepth: 1, redoDepth: 0 }], [{ undoDepth: 2, redoDepth: 0 }], [{ undoDepth: 1, redoDepth: 1 }]]);
    });

    test('exposes undo and redo that run the handle\'s commands and hand focus back to the editor', async () => {
      const component = await mountSurface();
      const surface = component.findComponent(EditorSurface).vm as unknown as { undo: () => void; redo: () => void };
      const focusBefore = harness.focusCalls;

      surface.undo();
      surface.redo();

      expect(harness.handleCalls.map((call) => call.command)).toEqual(['undo', 'redo']);
      expect(harness.focusCalls).toBe(focusBefore + 2);
    });
  });

  /**
   * The selection toolbar (`EditorSelectionToolbar`) over a non-empty text
   * selection: shown from the selection plugin's report while the editor
   * — or the toolbar itself — has focus, placed by `positionToolbar`,
   * acting through the handle. Its own contract (the roving keyboard, the
   * link popover) is `EditorSelectionToolbar.test.ts`; this holds the
   * wiring.
   */
  describe('the selection toolbar', () => {
    const NO_MARKS = { strong: false, emphasis: false, delete: false, inlineCode: false, link: false };
    const RANGE: SelectionReport = {
      kind: 'text',
      from: 1,
      to: 5,
      empty: false,
      marks: NO_MARKS,
      link: null,
      coords: { from: { top: 300, bottom: 326, left: 400, right: 400 }, to: { top: 300, bottom: 326, left: 480, right: 480 } },
    };

    function toolbar(component: { find: (selector: string) => { exists: () => boolean } }) {
      return component.find('[role="toolbar"][aria-label="Text formatting"]');
    }

    async function focusEditor(component: Awaited<ReturnType<typeof mountSurface>>): Promise<void> {
      component.get('[data-testid="editor-surface"]').element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      await component.vm.$nextTick();
    }

    test('appears over a non-empty text selection while the editor has focus, where positionToolbar puts it, and goes when the selection collapses', async () => {
      const component = await mountSurface();
      await focusEditor(component);
      expect(toolbar(component).exists()).toBe(false);

      harness.select(RANGE);
      await component.vm.$nextTick();

      expect(toolbar(component).exists()).toBe(true);
      const expected = positionToolbar(RANGE.coords!);
      const style = (component.get('[role="toolbar"]').element as HTMLElement).style;
      expect(Number.parseFloat(style.top)).toBe(expected.top);
      expect(Number.parseFloat(style.left)).toBe(expected.left);

      harness.select({ ...RANGE, to: 1, empty: true });
      await component.vm.$nextTick();
      expect(toolbar(component).exists()).toBe(false);
    });

    test('stays away inside a code block, over a node selection, and while the editor is not focused', async () => {
      const component = await mountSurface();

      harness.select(RANGE);
      await component.vm.$nextTick();
      expect(toolbar(component).exists(), 'no focus yet').toBe(false);

      await focusEditor(component);
      expect(toolbar(component).exists()).toBe(true);
      harness.select({ ...RANGE, kind: 'code' });
      await component.vm.$nextTick();
      expect(toolbar(component).exists(), 'code block').toBe(false);
      harness.select({ ...RANGE, kind: 'node' });
      await component.vm.$nextTick();
      expect(toolbar(component).exists(), 'node selection').toBe(false);

      harness.select(RANGE);
      await component.vm.$nextTick();
      expect(toolbar(component).exists()).toBe(true);
      const outside = document.createElement('button');
      document.body.append(outside);
      component.get('[data-testid="editor-surface"]').element.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
      await component.vm.$nextTick();
      expect(toolbar(component).exists(), 'focus left the editor').toBe(false);
      outside.remove();
    });

    test('reflects the marks the plugin reports, and a button runs the handle\'s toggleMark, setLink or unsetLink', async () => {
      const component = await mountSurface();
      await focusEditor(component);
      harness.select({ ...RANGE, marks: { ...NO_MARKS, emphasis: true } });
      await component.vm.$nextTick();

      expect(component.get('[role="toolbar"] button[aria-label="Italic"]').attributes('aria-pressed')).toBe('true');
      await component.get('[role="toolbar"] button[aria-label="Bold"]').trigger('click');
      const bubble = component.findComponent(EditorSelectionToolbar);
      bubble.vm.$emit('setLink', 'https://example.com');
      bubble.vm.$emit('unsetLink');
      await component.vm.$nextTick();

      expect(harness.handleCalls).toEqual([
        { command: 'toggleMark', args: ['strong'] },
        { command: 'setLink', args: ['https://example.com'] },
        { command: 'unsetLink', args: [] },
      ]);
    });

    test('Ctrl+Shift+. from the editor moves focus into the toolbar, and Escape there hands it back', async () => {
      const component = await mountSurface({ attachTo: document.body });
      await focusEditor(component);
      harness.select(RANGE);
      await component.vm.$nextTick();
      const focusBefore = harness.focusCalls;

      // `Shift`+`.` reports `>` on a US layout; the code names the key.
      await component.get('[data-testid="editor-surface"]').trigger('keydown', { key: '>', code: 'Period', ctrlKey: true, shiftKey: true });

      const bold = component.get('[role="toolbar"] button[aria-label="Bold"]');
      expect(document.activeElement).toBe(bold.element);

      await bold.trigger('keydown', { key: 'Escape' });
      expect(harness.focusCalls).toBe(focusBefore + 1);
      component.unmount();
    });
  });

  /**
   * The block handle (`EditorBlockHandle`) and its tunes: one handle that
   * follows the block under the pointer through the handle's `blockAt`,
   * drags it through `startBlockDrag`/`endBlockDrag`, and opens a menu
   * whose items come from dry-running the block commands on the block
   * (`utils/block-tunes.ts`) after the caret has been placed in it. The
   * keyboard reaches the same menu for the caret's block.
   */
  describe('the block handle and its tunes', () => {
    const HIT = {
      pos: 0,
      node: { type: { name: 'paragraph' }, attrs: {}, firstChild: null },
      rect: { left: 300, top: 140, right: 900, bottom: 166, width: 600, height: 26 },
    };

    async function hover(component: Awaited<ReturnType<typeof mountSurface>>): Promise<void> {
      const editor = component.get('[data-testid="editor-surface"]');
      editor.element.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 150 }));
      // Throttled to one lookup per frame.
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
      await component.vm.$nextTick();
    }

    function handle(component: Awaited<ReturnType<typeof mountSurface>>) {
      return component.find('[data-testid="block-handle"]');
    }

    function menuItems(): HTMLElement[] {
      return Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    }

    async function settle(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    test('appears beside the block under the pointer, at its top, and not while no block is under it', async () => {
      const component = await mountSurface({ attachTo: document.body });
      expect(handle(component).exists()).toBe(false);

      await hover(component);
      expect(handle(component).exists(), 'nothing under the pointer').toBe(false);

      harness.blockHit = HIT;
      await hover(component);
      expect(handle(component).exists()).toBe(true);
      // happy-dom lays nothing out: the host's box is at 0, so the block's
      // viewport top is the handle's offset.
      expect((handle(component).element as HTMLElement).style.top).toBe(`${HIT.rect.top}px`);
      component.unmount();
    });

    test('opening the menu places the caret in the block first, then offers the tunes from dry runs — a refused move disabled with its reason', async () => {
      harness.blockHit = HIT;
      harness.dryRuns.moveBlockUp = false;
      const component = await mountSurface({ attachTo: document.body });
      await hover(component);
      expect(harness.caretPlacedAt).toBeNull();

      await handle(component).get('button').trigger('click');
      await settle();

      expect(harness.caretPlacedAt).toBe(HIT.pos);
      const items = menuItems();
      const labels = items.map((item) => item.textContent?.replace(/\s+/g, ' ').trim());
      expect(labels.some((label) => label?.startsWith('Turn into'))).toBe(true);
      const up = items.find((item) => item.textContent?.includes('Move up'))!;
      expect(up.getAttribute('aria-disabled')).toBe('true');
      expect(up.textContent).toContain('Already the first block.');
      const down = items.find((item) => item.textContent?.includes('Move down'))!;
      expect(down.getAttribute('aria-disabled')).toBeNull();

      const focusBefore = harness.focusCalls;
      down.click();
      await settle();
      expect(harness.handleCalls.map((call) => call.command)).toContain('moveBlockDown');
      expect(harness.focusCalls, 'focus goes back to the editor').toBeGreaterThan(focusBefore);
      component.unmount();
    });

    test('Duplicate and Delete run the handle\'s commands', async () => {
      harness.blockHit = HIT;
      const component = await mountSurface({ attachTo: document.body });
      await hover(component);

      await handle(component).get('button').trigger('click');
      await settle();
      menuItems().find((item) => item.textContent?.includes('Duplicate'))!.click();
      await settle();
      // The menu closed and the handle went with it (the block it stood
      // beside may have moved); the pointer brings it back.
      expect(handle(component).exists()).toBe(false);
      await hover(component);
      await handle(component).get('button').trigger('click');
      await settle();
      menuItems().find((item) => item.textContent?.includes('Delete'))!.click();
      await settle();

      expect(harness.handleCalls.map((call) => call.command)).toEqual(['duplicateBlock', 'deleteBlock']);
      component.unmount();
    });

    test('Turn into on a list item chains Text first, so a heading does not land inside the item', async () => {
      harness.blockHit = { ...HIT, node: { type: { name: 'list' }, attrs: { ordered: false }, firstChild: null } };
      const component = await mountSurface({ attachTo: document.body });
      await hover(component);
      await handle(component).get('button').trigger('click');
      await settle();

      const turnInto = menuItems().find((item) => item.textContent?.includes('Turn into'))!;
      turnInto.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }));
      turnInto.click();
      await settle();
      const heading = menuItems().find((item) => item.textContent?.includes('Heading 1'))!;
      heading.click();
      await settle();

      expect(harness.handleCalls).toEqual([
        { command: 'turnInto', args: ['text'] },
        { command: 'turnInto', args: ['heading-1'] },
      ]);
      component.unmount();
    });

    test('a drag from the handle starts the block drag with the event\'s dataTransfer, and its end clears it', async () => {
      harness.blockHit = { ...HIT, pos: 4 };
      const component = await mountSurface({ attachTo: document.body });
      await hover(component);
      const button = handle(component).get('button');

      const dragstart = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() });
      button.element.dispatchEvent(dragstart);
      button.element.dispatchEvent(new DragEvent('dragend', { bubbles: true }));

      expect(harness.handleCalls[0]).toEqual({ command: 'startBlockDrag', args: [4, dragstart.dataTransfer] });
      expect(harness.handleCalls[1]?.command).toBe('endBlockDrag');
      component.unmount();
    });

    test('Ctrl+/ from the editor opens the menu for the caret\'s block, without a pointer', async () => {
      const component = await mountSurface({ attachTo: document.body });
      expect(handle(component).exists()).toBe(false);

      await component.get('[data-testid="editor-surface"]').trigger('keydown', { key: '/', code: 'Slash', ctrlKey: true });
      await settle();

      expect(handle(component).exists()).toBe(true);
      expect(harness.caretPlacedAt, 'the caret\'s own block: no move needed').toBe(0);
      expect(menuItems().length).toBeGreaterThan(0);
      component.unmount();
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
   * Since `keymap.ts` bound `Enter` (2026-09-14) the keymap plugin — first
   * in `buildEditorPlugins`' list — claims Enter before the menus, so
   * Enter in an open `/` or `@` menu split the block instead of confirming
   * (docs/TODO.md Findings, 2026-09-16). The package is another batch's;
   * the host confirms on the capture phase of its own wrapper, where the
   * key can be taken before ProseMirror's listener on the editor sees it,
   * through the same one-transaction confirm the click uses.
   */
  describe('Enter and Tab in an open menu confirm, before the keymap can split the block', () => {
    test('Enter with the slash menu open runs the highlighted command and never reaches the editor', async () => {
      const component = await mountSurface();
      openSlashMenu('');
      await component.vm.$nextTick();
      const editor = component.get('[data-testid="editor-surface"]');
      let reachedEditor = false;
      editor.element.addEventListener('keydown', () => {
        reachedEditor = true;
      });

      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      editor.element.dispatchEvent(enter);
      await component.vm.$nextTick();

      expect(enter.defaultPrevented).toBe(true);
      expect(reachedEditor, 'stopped on the capture phase').toBe(false);
      const first = (await import('@deep-wiki/editor/mount')).SLASH_COMMANDS[0]!;
      expect(harness.confirmed).toEqual({ kind: 'slash', id: first.id });
      expect(component.find('[role="listbox"]').exists()).toBe(false);
    });

    test('Tab with the mention menu open inserts the highlighted candidate', async () => {
      const component = await mountSurface();
      await openMentionMenu('a');
      const editor = component.get('[data-testid="editor-surface"]');

      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      editor.element.dispatchEvent(tab);
      await component.vm.$nextTick();

      expect(tab.defaultPrevented).toBe(true);
      expect(harness.confirmed).toEqual({ kind: 'mention', label: PEOPLE[0]!.label });
    });

    test('Enter with no menu open is the editor\'s own', async () => {
      const component = await mountSurface();
      const editor = component.get('[data-testid="editor-surface"]');

      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      editor.element.dispatchEvent(enter);

      expect(enter.defaultPrevented).toBe(false);
      expect(harness.confirmed).toBeNull();
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

    /**
     * The `/` menu is data-driven from the shipped `SLASH_COMMANDS`, which
     * gained Text, Task list, Table and Footnote on 2026-09-16; each row
     * carries an icon *beside* its label, never instead of it (§4.3), from
     * the one map the tunes menu's "Turn into" reads too.
     */
    test('the slash menu lists the block commands the package ships, each with an icon beside its label', async () => {
      const component = await mountSurface();

      openSlashMenu('');
      await component.vm.$nextTick();

      const menu = component.get('[role="listbox"][aria-label="Block commands"]');
      const options = menu.findAll('[role="option"]');
      const labels = options.map((option) => option.text());
      for (const expected of ['Text', 'Task list', 'Table', 'Footnote']) {
        expect(labels.some((label) => label.startsWith(expected)), expected).toBe(true);
      }
      for (const option of options) {
        const icon = option.find('[class*="i-lucide-"], .iconify, svg');
        expect(icon.exists(), `${option.text()} has an icon`).toBe(true);
        expect(icon.attributes('aria-hidden')).toBe('true');
      }
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
