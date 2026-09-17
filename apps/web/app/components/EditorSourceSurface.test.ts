import { UApp } from '#components';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, test } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import EditorSourceSurface from './EditorSourceSurface.vue';

/**
 * The source view of edit mode (owner decision, 2026-09-17): the same
 * document as raw markdown, in a plain text area set like the reading
 * surface — no CodeMirror, no second editor dependency. What this file
 * holds: the text area reports every edit to the screen that owns the
 * buffer; `Tab` indents by two spaces where the caret is instead of
 * leaving; `Escape` is the stated way out, so the captured `Tab` is not
 * a keyboard trap (checklist §5); and it is named and described.
 *
 * What a browser owns: the toggle, the bytes that come back after a
 * save, the refusal of a non-canonical source — `e2e/editor-source.spec.ts`.
 */
const mounted: Awaited<ReturnType<typeof mountSuspended>>[] = [];

async function mount(markdown = '# Title\n\nA paragraph.\n') {
  const wrapper = await mountSuspended(
    defineComponent({
      name: 'SourceInApp',
      setup: () => () => h(UApp, null, { default: () => h(EditorSourceSurface, { markdown }) }),
    }),
    { attachTo: document.body },
  );
  mounted.push(wrapper);
  return wrapper;
}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = '';
});

function textarea(component: Awaited<ReturnType<typeof mount>>): HTMLTextAreaElement {
  return component.get('[data-testid="editor-source"]').element as HTMLTextAreaElement;
}

describe('EditorSourceSurface', () => {
  test('shows the markdown it was given, named for assistive technology and described with its keys', async () => {
    const component = await mount('# Title\n\nA paragraph.\n');
    const area = textarea(component);

    expect(area.tagName).toBe('TEXTAREA');
    expect(area.value).toBe('# Title\n\nA paragraph.\n');
    expect(area.getAttribute('aria-label')).toBe('Page source');
    expect(area.getAttribute('spellcheck')).toBe('false');
    const describedBy = area.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const description = document.getElementById(describedBy!);
    expect(description?.textContent).toMatch(/Tab inserts two spaces/);
    expect(description?.textContent).toMatch(/Escape/);
  });

  test('reports every edit as the new markdown, undebounced', async () => {
    const component = await mount('one\n');
    const area = textarea(component);

    area.value = 'one\ntwo\n';
    area.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();

    expect(component.findComponent(EditorSourceSurface).emitted('update')).toEqual([['one\ntwo\n']]);
  });

  test('Tab inserts two spaces at the caret, keeps focus in the text area, and reports the edit', async () => {
    const component = await mount('- a\n- b\n');
    const area = textarea(component);
    area.focus();
    area.setSelectionRange(4, 4);

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    area.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(area.value).toBe('- a\n  - b\n');
    expect(area.selectionStart).toBe(6);
    expect(area.selectionEnd).toBe(6);
    expect(document.activeElement).toBe(area);
    expect(component.findComponent(EditorSourceSurface).emitted('update')).toEqual([['- a\n  - b\n']]);
  });

  test('Tab over a selection replaces it with two spaces, like any typed character', async () => {
    const component = await mount('abcdef\n');
    const area = textarea(component);
    area.focus();
    area.setSelectionRange(2, 4);

    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await nextTick();

    expect(area.value).toBe('ab  ef\n');
    expect(area.selectionStart).toBe(4);
  });

  test('Shift+Tab is left to the browser, so focus can still move backwards', async () => {
    const component = await mount('x\n');
    const area = textarea(component);
    area.focus();

    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    area.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(area.value).toBe('x\n');
  });

  test('Escape leaves the text area: focus goes to the content bar when there is one, and the edit is kept', async () => {
    const bar = document.createElement('div');
    bar.id = 'content-bar';
    bar.tabIndex = -1;
    document.body.append(bar);
    const component = await mount('x\n');
    const area = textarea(component);
    area.focus();
    area.value = 'xy\n';
    area.dispatchEvent(new Event('input', { bubbles: true }));

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    area.dispatchEvent(event);
    await nextTick();

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(bar);
    expect(area.value).toBe('xy\n');
  });

  test('exposes focus(), which puts the caret in the text area', async () => {
    const component = await mount('x\n');
    const surface = component.findComponent(EditorSourceSurface);

    (surface.vm as unknown as { focus: () => void }).focus();

    expect(document.activeElement).toBe(textarea(component));
  });
});
