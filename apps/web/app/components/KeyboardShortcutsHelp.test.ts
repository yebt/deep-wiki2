import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import type { KeyboardShortcut } from '~/composables/useKeyboardShortcuts';
import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.vue';

/**
 * The `?` the owner clicked and nothing happened (2026-09-23). What is
 * asserted here is the difference between a control and a picture of one:
 * it is a button that says it opens a dialog, the surface it opens names
 * every key beside what the key does, and Escape closes it with focus
 * returned to the trigger (docs/UI-CHECKLIST.md §5, §6's "no inert
 * interactions").
 *
 * **Where each half is held, and why.** A `UPopover` trigger's click does
 * not toggle under this test environment, and its non-modal content never
 * mounts: measured on 2026-09-23 across eleven variants — uncontrolled and
 * `v-model:open`, with and without the tooltip wrapper, with and without a
 * wrapping element, and `defaultOpen` on its own — a click left
 * `data-state="closed"` and portalled nothing, while `modal` rendered the
 * same content immediately. So the tests below mount the surface **open and
 * modal**, through attribute fallthrough onto the `UPopover` this component's
 * root is. What they then read is this component's own markup, which Reka
 * renders identically in both modes (one `PopoverContentImpl`, one set of
 * children); the *click* that opens it, and Escape's focus return, are held
 * in `e2e/tree-writes.spec.ts` against a real browser. Recorded in
 * docs/TODO.md.
 */
const SHORTCUTS: KeyboardShortcut[] = [
  { keys: ['↑', '↓'], spoken: 'The up and down arrows', description: 'move through the tree' },
  { keys: ['F2'], spoken: 'F2', description: 'renames an item where it stands' },
];

/** Open, and modal so this environment mounts the content at all (see above). */
const OPEN = { defaultOpen: true, modal: true };

let wrapper: Awaited<ReturnType<typeof mountSuspended>> | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mount(props: Record<string, unknown> = {}) {
  const host = defineComponent({
    name: 'HelpInApp',
    setup: () => () => h(UApp, null, { default: () => h(KeyboardShortcutsHelp, { shortcuts: SHORTCUTS, heading: 'Tree keys', ...props }) }),
  });
  // Attached: the focus return on close is only real for a node the
  // document holds.
  wrapper = await mountSuspended(host, { attachTo: document.body });
  await nextTick();
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  return wrapper;
}

function trigger(component: NonNullable<typeof wrapper>) {
  return component.get('[data-testid="keyboard-help-open"]');
}

/** Reka draws a popover's content as a dialog, portalled into the body. */
function surface(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"]');
}

describe('KeyboardShortcutsHelp', () => {
  test('the control is a real button, named, that says it opens a dialog', async () => {
    const component = await mount();
    const button = trigger(component);

    expect(button.attributes('type')).toBe('button');
    expect(button.attributes('aria-label')).toBe('Keyboard help');
    expect(button.attributes('aria-haspopup')).toBe('dialog');
    expect(button.attributes('aria-expanded')).toBe('false');
  });

  test('while it is open the trigger says so', async () => {
    const component = await mount(OPEN);
    // `aria-controls` is Reka's and is asserted in the browser instead
    // (`e2e/tree-writes.spec.ts`): this environment leaves it empty even
    // with the content mounted.
    expect(trigger(component).element.getAttribute('aria-expanded')).toBe('true');
  });

  test('the surface it opens names every key, drawn beside what the key does', async () => {
    await mount(OPEN);

    const panel = surface();
    expect(panel, 'the control opens something').not.toBeNull();
    expect(panel!.textContent).toContain('Tree keys');
    for (const shortcut of SHORTCUTS) {
      expect(panel!.textContent).toContain(shortcut.description);
      for (const key of shortcut.keys) expect(panel!.textContent).toContain(key);
    }
  });

  test('the chord is the term and the phrase its definition, in that reading order', async () => {
    await mount(OPEN);

    const pairs = [...surface()!.querySelectorAll('dl > div')];
    expect(pairs).toHaveLength(SHORTCUTS.length);
    expect(pairs[0]!.firstElementChild?.tagName, 'the keys are the term').toBe('DT');
    expect(pairs[0]!.lastElementChild?.tagName, 'the phrase is the definition').toBe('DD');
    // No CSS `order` reversing what a screen reader hears against what the
    // eye reads (the 2026-09-04 footer finding, one component down).
    for (const pair of pairs) expect(pair.className).not.toMatch(/\border-/);
  });

  test('Escape closes it and focus comes back to the control that opened it', async () => {
    const component = await mount(OPEN);
    const button = trigger(component);
    expect(surface()).not.toBeNull();

    surface()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(surface()).toBeNull();
    expect(document.activeElement).toBe(button.element);
    expect(trigger(component).attributes('aria-expanded')).toBe('false');
  });

  test('the surface is the menu rung, so it reads as an overlay and not as part of the pane', async () => {
    await mount(OPEN);
    // docs/DESIGN-SYSTEM.md §9.6 puts every popover on `bg-accented`.
    expect(surface()!.className).toContain('bg-accented');
  });

  test('the label is the caller’s, so a second surface can name its own keys', async () => {
    const component = await mount({ label: 'Editor keyboard help', heading: 'Editing keys' });
    expect(trigger(component).attributes('aria-label')).toBe('Editor keyboard help');
  });
});
