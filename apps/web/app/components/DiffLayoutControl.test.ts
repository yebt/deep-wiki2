import { UApp, UButton, UTooltip } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import { defineComponent, h } from 'vue';
import DiffLayoutControl from './DiffLayoutControl.vue';
import type { DiffLayout } from '~/composables/useDiffLayout';

/** Tooltips need `UApp`'s provider; the emitted events are collected off the inner component. */
async function mount(layout: DiffLayout) {
  const wrapper = await mountSuspended(
    defineComponent({
      name: 'ControlInApp',
      setup: () => () => h(UApp, null, { default: () => h(DiffLayoutControl, { layout }) }),
    }),
  );
  return { wrapper, control: wrapper.findComponent(DiffLayoutControl) };
}

/**
 * The segmented control that chooses how an edited block's two sides are
 * laid out — "Unified | Side by side" — shared by the page diff and the
 * book diff through `DiffBlockChanges`. M3's segmented button: outlined
 * container, the selected segment on the opaque `secondary-container`
 * pair and saying so with `aria-pressed` (docs/UI-CHECKLIST.md §5: never
 * colour alone; §4.3: an icon beside a visible label, never instead).
 */
describe('DiffLayoutControl', () => {
  test('is a named group of two pressable buttons, the current layout pressed', async () => {
    const { wrapper: component } = await mount('unified');

    const group = component.get('[role="group"]');
    expect(group.attributes('aria-label')).toBe('Diff layout');
    // A real `UFieldGroup`, not an unresolved tag: an unknown component
    // renders its children on the client and nothing on the server, which
    // is how this control first shipped invisible until hydration.
    expect(group.find('[data-orientation="horizontal"]').exists()).toBe(true);
    expect(component.html()).not.toMatch(/<ubuttongroup/i);
    const buttons = component.findAllComponents(UButton);
    expect(buttons.map((b) => b.text())).toEqual(['Unified', 'Side by side']);
    expect(buttons[0]!.attributes('aria-pressed')).toBe('true');
    expect(buttons[1]!.attributes('aria-pressed')).toBe('false');
    expect(buttons[0]!.props('variant')).toBe('soft');
    expect(buttons[0]!.props('color')).toBe('secondary');
    expect(buttons[1]!.props('variant')).toBe('outline');
  });

  test('the other segment is pressed when the layout is side by side', async () => {
    const { wrapper: component } = await mount('side-by-side');

    const buttons = component.findAllComponents(UButton);
    expect(buttons[0]!.attributes('aria-pressed')).toBe('false');
    expect(buttons[1]!.attributes('aria-pressed')).toBe('true');
  });

  test('emits the chosen layout on click, and nothing for the one already pressed', async () => {
    const { wrapper: component, control } = await mount('unified');

    const buttons = component.findAllComponents(UButton);
    await buttons[1]!.trigger('click');
    expect(control.emitted('change')).toEqual([['side-by-side']]);
    await buttons[0]!.trigger('click');
    expect(control.emitted('change')).toEqual([['side-by-side']]);
  });

  test('each segment carries a tooltip, and side by side states that it falls back to one column below 768px', async () => {
    const { wrapper: component } = await mount('unified');

    const texts = component.findAllComponents(UTooltip).map((tooltip) => String(tooltip.props('text')));
    expect(texts).toHaveLength(2);
    expect(texts[1]).toMatch(/below 768px/i);
    expect(texts[1]).toMatch(/one column/i);
  });
});
