import { describe, expect, test } from 'vitest';
import { createSSRApp, defineComponent, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import AuthSubmit from './AuthSubmit.vue';

/**
 * These tests do not mount the component. That is the whole point.
 *
 * The defect this component exists to prevent lives in the window *before*
 * the page hydrates: a server-rendered `<form>` whose submit control is
 * already operable, with no Vue handler attached to intercept it. A test
 * that mounts an already-hydrated component cannot observe that window at
 * all — it starts after the bug is over — so it would pass against the
 * broken component and prove nothing.
 *
 * So the timeline is reproduced literally: render the component the way the
 * server does (`renderToString`), put those exact bytes in the document, and
 * assert against that DOM. Then hydrate the same nodes the way the browser
 * does (`createSSRApp(...).mount(el)`) and assert what changed.
 *
 * What this cannot hold: real geometry. happy-dom has no layout engine, so
 * "no layout shift" is asserted here as the strongest thing a DOM can say —
 * the button is the *same element*, with the *same classes*, on both sides
 * of hydration. The measured version of that claim belongs to
 * `e2e/auth-layout.spec.ts`, which measures rendered boxes in a real
 * browser, and is not owned by this file.
 */

/** The submit control as the four auth screens use it: inside a form. */
const FormWithSubmit = defineComponent({
  name: 'FormWithSubmit',
  props: { label: { type: String, required: true } },
  setup: (props) => () => h('form', null, [h(AuthSubmit, { label: props.label })]),
});

async function serverRender(label: string): Promise<string> {
  return await renderToString(createSSRApp(FormWithSubmit, { label }));
}

function intoDocument(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

async function hydrate(host: HTMLElement, label: string): Promise<void> {
  createSSRApp(FormWithSubmit, { label }).mount(host);
  await nextTick();
}

describe('AuthSubmit — the pre-hydration window', () => {
  test('the server-rendered form carries no control that can submit it', async () => {
    const host = intoDocument(await serverRender('Sign in'));

    // A form with no submit control cannot be submitted by the browser:
    // clicking a `type="button"` does nothing, and Enter in a field has
    // nothing to trigger. That is what stops the native POST to the page's
    // own URL that cleared every field and looked like a failed login.
    expect(host.querySelector('button[type="submit"]')).toBeNull();
    expect(host.querySelector('input[type="submit"]')).toBeNull();
    expect(host.querySelector('button')?.getAttribute('type')).toBe('button');
  });

  test('the unavailable control says why, and stays in the tab order while it does', async () => {
    const host = intoDocument(await serverRender('Sign in'));
    const button = host.querySelector('button');

    // docs/UI-CHECKLIST.md §3: a disabled control with no reason is itself a
    // defect. The reason is the label, so it is readable without a hover a
    // keyboard user cannot perform and without JavaScript that has not run.
    expect(button?.textContent).toMatch(/preparing/i);
    expect(button?.textContent).not.toMatch(/sign in/i);

    // §5: `aria-disabled`, never the `disabled` attribute, whenever the
    // control carries an explanation — the attribute would take it out of
    // the tab order and put its own reason out of reach.
    expect(button?.getAttribute('aria-disabled')).toBe('true');
    expect(button?.hasAttribute('disabled')).toBe(false);
  });

  test('a browser with JavaScript switched off is told so, rather than left with a control that does nothing', async () => {
    const html = await serverRender('Sign in');

    // `<noscript>` is the only thing that can tell "not hydrated yet" apart
    // from "will never hydrate". It renders nothing at all when scripting is
    // enabled, so it costs the hydrated page no layout.
    expect(html).toContain('<noscript');
    expect(html).toMatch(/needs JavaScript/i);
  });

  test('the control is the last thing in the form, so the form’s rhythm never pads under the primary action', async () => {
    const host = intoDocument(await serverRender('Sign in'));
    const form = host.querySelector('form')!;

    // `UAuthForm`'s form is `space-y-6`, which gives every child but the
    // last a 24px margin below it. With `<noscript>` rendered *after* the
    // button, the button was not the last child, and measured 24px of dead
    // space under it in every card (2026-09-15, 1280x900: button bottom
    // 652, form bottom 676). The explanation for a scriptless browser goes
    // above the control it explains, and the control closes the form.
    expect(form.lastElementChild?.tagName).toBe('BUTTON');
    expect(host.querySelector('noscript')?.nextElementSibling?.tagName).toBe('BUTTON');
  });

  test('hydration turns it into a real submit control, in place', async () => {
    const host = intoDocument(await serverRender('Sign in'));
    const before = host.querySelector('button');
    const classesBefore = before?.getAttribute('class');

    await hydrate(host, 'Sign in');

    const after = host.querySelector('button');
    expect(after?.getAttribute('type')).toBe('submit');
    expect(after?.textContent).toMatch(/sign in/i);
    expect(after?.getAttribute('aria-disabled')).toBeNull();

    // The same element, with the same classes, before and after — so the
    // change is a label and two attributes, never a box that resizes or a
    // node that is thrown away and rebuilt (docs/UI-CHECKLIST.md §3, "no
    // layout shift on load").
    expect(after).toBe(before);
    expect(after?.getAttribute('class')).toBe(classesBefore);
  });
});
