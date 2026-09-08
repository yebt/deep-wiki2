import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import PageHeading from './PageHeading.vue';

/**
 * The page heading block: the optional eyebrow, the page's single `<h1>`,
 * its supporting sentence, and the three distances between them.
 *
 * Every rule asserted here is one a review already caught being broken
 * while the block existed in more than one file: the eyebrow that
 * paraphrased the heading beneath it (2026-09-04, removed from all four
 * auth screens), the `<h1>` that changed type role between a screen's
 * states (2026-09-07, §4.4), and the supporting sentence set at the
 * document's leading on one screen and chrome's on another
 * (docs/DESIGN-SYSTEM.md §2.3 — "chrome text keeps M3's 24px leading").
 * The type role and the measure cap are class assertions because a class
 * is the only place a type role exists in this stack: `text-body-large`
 * *is* 16px on 24px, and there is no other way to observe it without a
 * layout engine.
 */
describe('PageHeading', () => {
  test('renders the page’s single h1, and nothing else that is a heading', async () => {
    const component = await mountSuspended(PageHeading, { props: { heading: 'Navigation tree' } });

    expect(component.findAll('h1')).toHaveLength(1);
    expect(component.get('h1').text()).toBe('Navigation tree');
    expect(component.findAll('h2, h3, h4, h5, h6')).toHaveLength(0);
  });

  test('the h1 keeps one type role, the one §2.3 gives a page title', async () => {
    const component = await mountSuspended(PageHeading, { props: { heading: 'Navigation tree' } });

    // 28px on 36px. A screen's h1 renders at this role in every state it
    // has — the failure §4.4 records is a heading that shrank to 24px
    // whenever the request went badly, so the type scale reported the
    // outcome.
    expect(component.get('h1').classes()).toContain('text-headline-medium');
  });

  test('an eyebrow renders above the heading, and only when there is one to render', async () => {
    const withEyebrow = await mountSuspended(PageHeading, {
      props: { eyebrow: 'Acme / Handbook', heading: 'Onboarding' },
    });
    const without = await mountSuspended(PageHeading, { props: { heading: 'Onboarding' } });

    const children = [...withEyebrow.element.children];
    expect(children[0]!.tagName).toBe('P');
    expect(children[0]!.textContent).toBe('Acme / Handbook');
    expect(children[1]!.tagName).toBe('H1');

    // No eyebrow means no empty element above the heading — the auth
    // screens' h1 is the first thing in the block (2026-09-04 review).
    expect([...without.element.children][0]!.tagName).toBe('H1');
    expect(without.findAll('p')).toHaveLength(0);
  });

  test('the eyebrow’s distance to the heading belongs to the block, not to the heading', async () => {
    const withEyebrow = await mountSuspended(PageHeading, {
      props: { eyebrow: 'Acme / Handbook', heading: 'Onboarding' },
    });
    const without = await mountSuspended(PageHeading, { props: { heading: 'Onboarding' } });

    // 8px below the eyebrow; nothing at all when the h1 is first, so the
    // block does not start with a stray gap.
    expect(withEyebrow.get('h1').classes()).toContain('mt-2');
    expect(without.get('h1').classes()).not.toContain('mt-2');
  });

  test('the supporting sentence is chrome, not document prose', async () => {
    const component = await mountSuspended(PageHeading, {
      props: { heading: 'Navigation tree', description: 'Every shelf, book, chapter and page you can read.' },
    });

    const description = component.get('h1 + p');
    expect(description.text()).toBe('Every shelf, book, chapter and page you can read.');
    // `body-large` (16/24), never `doc-body` (16/26). §2.3's longer leading
    // is the one deviation this project makes, and it is reserved for the
    // reading surface — the same sentence must not be set solid two ways on
    // two screens.
    expect(description.classes()).toContain('text-body-large');
    expect(description.classes()).not.toContain('text-doc-body');
  });

  test('a screen with no supporting sentence renders no empty paragraph', async () => {
    const component = await mountSuspended(PageHeading, { props: { heading: 'Navigation tree' } });

    expect(component.findAll('p')).toHaveLength(0);
  });

  test('the block caps its own prose at the measure, for the screens that stand on the wide column', async () => {
    const component = await mountSuspended(PageHeading, {
      props: { heading: 'Bootstrap', description: 'A sentence long enough to run past 80 characters if nothing stops it.' },
    });

    // On `AppShell`'s `measure` column this is a no-op; on `wide` it is
    // what keeps a heading's sentence at 65-80 characters instead of 150
    // (§2.4 — `--ui-container` is the shell's max width, never the
    // reading measure).
    expect(component.element.className).toContain('max-w-measure');
  });
});
