import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { Draft, EditorSnapshot } from '~/composables/useTreeRowEditor';
import NavigationTreeRowEditor from './NavigationTreeRowEditor.vue';

/**
 * The one editable row, drawn. The owner asked for VS Code's
 * input-box-in-the-row (2026-09-23), and the two things that make such a
 * field usable are invisible in a screenshot:
 *
 * 1. **It has a name, and the name says what is being named.** "Name of the
 *    new page" / "Rename “Day one”" — an icon-only row with an unnamed box
 *    in it is docs/UI-CHECKLIST.md §5's "every form input has a
 *    programmatically associated label" failure, and the field is the whole
 *    control here.
 * 2. **Enter and Escape are the two answers, and nothing else leaves the
 *    field.** The tree around it moves focus on every arrow key and opens a
 *    page on Enter; a field that let those through would be unusable, so
 *    every key it handles is stopped from bubbling and the whole editor is
 *    marked `data-row-editor` so the row's own handler ignores what happens
 *    inside it.
 */

function snapshot(draft: Draft, overrides: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return { draft, phase: 'naming', value: '', error: null, ...overrides };
}

const CREATE: Draft = { mode: 'create', parentId: 'book-1', type: 'page', depth: 2, parentTitle: 'Handbook' };
const RENAME: Draft = { mode: 'rename', nodeId: 'page-1', type: 'page', originalTitle: 'Day one' };

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

type EditorProps = InstanceType<typeof NavigationTreeRowEditor>['$props'];

async function mount(props: EditorProps) {
  const host = defineComponent({
    setup: () => () => h(UApp, null, { default: () => h(NavigationTreeRowEditor, props) }),
  });
  // Attached: the field takes focus on mount, and focus is only real for an
  // element that is in the document (the same reason `CommentGutter.test.ts`
  // attaches for its roving-tabindex assertions).
  wrapper = await mountSuspended(host, { attachTo: document.body });
  await nextTick();
  await nextTick();
  return wrapper.element as HTMLElement;
}

function field(root: HTMLElement): HTMLInputElement {
  const input = root.querySelector('input');
  if (!input) throw new Error('the editor rendered no field');
  return input as HTMLInputElement;
}

describe('NavigationTreeRowEditor', () => {
  test('a creation names the kind being made', async () => {
    const root = await mount({ snapshot: snapshot(CREATE), depth: 2 });
    expect(field(root).getAttribute('aria-label')).toBe('Name of the new page');
  });

  test('the kind comes from the draft, so every legal type names itself', async () => {
    for (const [type, label] of [
      ['shelf', 'Name of the new shelf'],
      ['book', 'Name of the new book'],
      ['chapter', 'Name of the new chapter'],
    ] as const) {
      const root = await mount({ snapshot: snapshot({ ...CREATE, type }), depth: 1 });
      expect(field(root).getAttribute('aria-label')).toBe(label);
      wrapper?.unmount();
      wrapper = null;
    }
  });

  test('a rename names the row being renamed, and opens on its current title selected whole', async () => {
    const root = await mount({ snapshot: snapshot(RENAME, { value: 'Day one' }), depth: 3 });
    const input = field(root);

    expect(input.getAttribute('aria-label')).toBe('Rename “Day one”');
    expect(input.value).toBe('Day one');
    expect(input).toBe(document.activeElement);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Day one'.length]);
  });

  test('the field is where the keys are answered, and the row around it never sees them', async () => {
    const root = await mount({ snapshot: snapshot(CREATE), depth: 2 });
    expect(root.querySelector('[data-row-editor]')).not.toBeNull();
  });

  test('Enter commits, Escape cancels, and neither reaches the tree behind it', async () => {
    const events: string[] = [];
    const root = await mount({
      snapshot: snapshot(CREATE, { value: 'Notes' }),
      depth: 2,
      onCommit: () => events.push('commit'),
      onCancel: () => events.push('cancel'),
    });
    const input = field(root);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(enter);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(escape);

    expect(events).toEqual(['commit', 'cancel']);
    expect(enter.defaultPrevented, 'Enter must not also open a page').toBe(true);
    expect(escape.defaultPrevented).toBe(true);
  });

  test('typing reports the value out, so the state machine owns it and the field never does', async () => {
    const seen: string[] = [];
    const root = await mount({ snapshot: snapshot(CREATE), depth: 2, 'onUpdate:value': (value: string) => seen.push(value) });
    const input = field(root);

    input.value = 'Notes';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    expect(seen).toContain('Notes');
  });

  test('a refusal stands beside the field, is announced, and the typed text is still there', async () => {
    const root = await mount({
      snapshot: snapshot(CREATE, { phase: 'error', value: 'Notes', error: 'Something here already has that name. Choose another.' }),
      depth: 2,
    });
    const input = field(root);
    const alert = root.querySelector('[role="alert"]');

    expect(input.value, 'never renamed behind the person’s back').toBe('Notes');
    expect(alert?.textContent).toContain('already has that name');
    expect(input.getAttribute('aria-describedby')).toBe(alert?.id);
  });

  test('while the write is in flight the field says so', async () => {
    const root = await mount({ snapshot: snapshot(CREATE, { phase: 'committing', value: 'Notes' }), depth: 2 });
    expect(field(root).getAttribute('aria-busy')).toBe('true');
  });

  /**
   * Clicking away cancels, and the half-typed name is discarded — the same
   * outcome Escape has, because two ways out of one field that disagree
   * about the typed text is worse than either. The owner reported on
   * 2026-09-23 that only Escape got out of a draft row; VS Code's input box
   * behaves this way, and so does every explorer's rename.
   */
  describe('a pointerdown outside the field', () => {
    async function pointerDownOn(target: EventTarget): Promise<void> {
      target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
      await nextTick();
    }

    test('cancels, discarding the typed name, exactly as Escape does', async () => {
      const events: string[] = [];
      await mount({
        snapshot: snapshot(CREATE, { value: 'Half a name' }),
        depth: 2,
        onCommit: () => events.push('commit'),
        onCancel: () => events.push('cancel'),
      });

      await pointerDownOn(document.body);

      expect(events, 'cancelled, never committed behind the person’s back').toEqual(['cancel']);
    });

    test('a pointerdown inside the field is not outside it', async () => {
      const events: string[] = [];
      const root = await mount({ snapshot: snapshot(CREATE, { value: 'Notes' }), depth: 2, onCancel: () => events.push('cancel') });

      await pointerDownOn(field(root));
      await pointerDownOn(root.querySelector('[data-row-editor]')!);

      expect(events).toEqual([]);
    });

    test('a write already in flight is never abandoned by a stray click', async () => {
      const events: string[] = [];
      await mount({ snapshot: snapshot(CREATE, { phase: 'committing', value: 'Notes' }), depth: 2, onCancel: () => events.push('cancel') });

      await pointerDownOn(document.body);

      expect(events, 'the row must not vanish while the request is landing').toEqual([]);
    });

    test('the listener goes with the field: a pointerdown after it closes cancels nothing', async () => {
      const events: string[] = [];
      await mount({ snapshot: snapshot(RENAME, { value: 'Day one' }), depth: 1, onCancel: () => events.push('cancel') });
      wrapper?.unmount();
      wrapper = null;

      await pointerDownOn(document.body);

      expect(events).toEqual([]);
    });
  });

  test('the row keeps the tree’s indent, so the field is where the row would have been', async () => {
    const root = await mount({ snapshot: snapshot(CREATE), depth: 3 });
    const row = root.querySelector<HTMLElement>('[data-row-editor]');
    // depth * 12px + 8px, the indent NavigationTreeNode draws (DESIGN-SYSTEM §7.2).
    expect(row?.style.paddingLeft).toBe('44px');
  });

  test('the field is the row’s own height, so nothing above or below it moves', async () => {
    const root = await mount({ snapshot: snapshot(CREATE), depth: 0 });
    const line = root.querySelector('[data-row-editor] > div');
    expect(line?.className).toContain('h-10');
  });

  /**
   * The owner's fourth finding of 2026-09-23: the field read as "a tall
   * bordered box that dwarfs the row it sits in". It was a `UInput` — M3's
   * text field, an outlined 40px control with a ring — standing among rows
   * that carry no boundary at all.
   *
   * The correction is the treatment `docs/DESIGN-SYSTEM.md` §14 already
   * records twice, for the source view's text area (2026-09-17) and the
   * page's title field (2026-09-23): a text surface that *is* the thing
   * around it draws no box, and the caret in `primary` is its focus
   * indicator (WCAG 2.4.7 counts the text cursor for a text field).
   */
  describe('it reads as the row, being typed in', () => {
    test('draws no box: no ring, no border, no fill, no elevation', async () => {
      const root = await mount({ snapshot: snapshot(CREATE, { value: 'Notes' }), depth: 1 });
      const classes = field(root).className;

      expect(classes).not.toMatch(/(^|\s)ring/);
      expect(classes).not.toMatch(/(^|\s)(border|rounded|shadow)/);
      expect(classes).toContain('bg-transparent');
      // A `UInput` draws its ring, fill and radius on the root slot it
      // wraps the input in, so the absence has to be checked on the whole
      // editor and not only on the element that takes the typing.
      const editor = root.querySelector('[data-row-editor]')!;
      expect(editor.querySelectorAll('[class*="ring"], [class*="shadow"]')).toHaveLength(0);
      expect(field(root).tagName, 'the field is the input itself').toBe('INPUT');
    });

    test('the caret is the focus indicator, the same one the title field and the source view take', async () => {
      const root = await mount({ snapshot: snapshot(RENAME, { value: 'Day one' }), depth: 2 });
      // `main.css` §13 draws the caret in `primary` and no outline for this class.
      expect(field(root).className).toContain('dw-row-editor-field');
    });

    test('the text keeps §9.5’s 16px floor, which is the one thing it does not take from the row', async () => {
      const root = await mount({ snapshot: snapshot(CREATE), depth: 0 });
      // Below 16px iOS Safari zooms the viewport on focus, which binds every
      // text-entry control; the row's own 14px label gives way for it, as
      // the source view's 14px code role did (DESIGN-SYSTEM §14, 2026-09-17).
      expect(field(root).className).toContain('text-body-large');
    });

    test('a write in flight is said without a box either: a spinner beside the field, and aria-busy on it', async () => {
      const root = await mount({ snapshot: snapshot(CREATE, { phase: 'committing', value: 'Notes' }), depth: 0 });

      expect(field(root).getAttribute('aria-busy')).toBe('true');
      expect(root.querySelector('[data-testid="tree-row-editor-busy"]')).not.toBeNull();
    });
  });
});
