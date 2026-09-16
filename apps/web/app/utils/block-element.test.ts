import { describe, expect, test } from 'vitest';
import { adoptMintedAnchor, blockIdOf, blockSelector, commentableBlockOf } from './block-element';

/**
 * One notion of "the block an element is" for the read screen: `render()`
 * emits `data-block-id` on a block with a persisted anchor and
 * `data-derived-block-id` on an anchorable block without one
 * (`packages/markdown/src/render.ts`). Every place the overlay looks a
 * block up — placement, highlight, "Show in page", starting a thread —
 * goes through here, so the two attributes are never told apart twice.
 */
function article(html: string): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML = html;
  return el;
}

describe('block-element', () => {
  test('blockSelector matches a persisted or a derived id, and nothing else', () => {
    const root = article('<p data-block-id="abc">a</p><p data-derived-block-id="d:0123456789ab#0">b</p><p>c</p>');
    expect(root.querySelector(blockSelector('abc'))?.textContent).toBe('a');
    expect(root.querySelector(blockSelector('d:0123456789ab#0'))?.textContent).toBe('b');
    expect(root.querySelector(blockSelector('nope'))).toBeNull();
  });

  test('blockIdOf reads whichever identity the element carries; a persisted one wins', () => {
    const root = article('<p data-block-id="abc" data-derived-block-id="d:0123456789ab#0">a</p><p data-derived-block-id="d:0123456789ab#1">b</p><p>c</p>');
    const [first, second, third] = root.children;
    expect(blockIdOf(first!)).toBe('abc');
    expect(blockIdOf(second!)).toBe('d:0123456789ab#1');
    expect(blockIdOf(third!)).toBeNull();
  });

  test('commentableBlockOf walks up from a node to the top-level block that carries an identity, and only a top-level one', () => {
    const root = article('<p data-block-id="abc">a <em>nested <span data-block-id="forged">x</span></em></p><ul><li>plain</li></ul>');
    const span = root.querySelector('span')!;
    // A forged identity on a nested element is not a block; the block is
    // the article's own child.
    expect(commentableBlockOf(span.firstChild, root)?.getAttribute('data-block-id')).toBe('abc');
    expect(commentableBlockOf(root.querySelector('li')!.firstChild, root)).toBeNull();
    expect(commentableBlockOf(null, root)).toBeNull();
  });

  test('adoptMintedAnchor turns the derived identity into the persisted one the server just minted', () => {
    const root = article('<p data-derived-block-id="d:0123456789ab#0">a</p>');
    adoptMintedAnchor(root, 'd:0123456789ab#0', 'MINTED0001');
    const block = root.firstElementChild!;
    expect(block.getAttribute('data-block-id')).toBe('MINTED0001');
    expect(block.hasAttribute('data-derived-block-id')).toBe(false);
    // A second call for an id that is no longer there is a no-op.
    adoptMintedAnchor(root, 'd:0123456789ab#0', 'OTHER00001');
    expect(block.getAttribute('data-block-id')).toBe('MINTED0001');
  });
});
