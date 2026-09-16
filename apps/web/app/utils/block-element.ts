/**
 * The read screen's one notion of "which block is this element".
 *
 * `render()` (`packages/markdown/src/render.ts`) names a block two ways
 * and never both at once: `data-block-id` on a block with a persisted
 * anchor — the id every existing thread refers to — and
 * `data-derived-block-id` on a paragraph or heading with none yet, the
 * content-hashed identity `POST /pages/:id/comments` accepts and turns
 * into a persisted one. The overlay looks blocks up in four places
 * (placement, the highlight, "Show in page", starting a thread); each goes
 * through here so the two spellings are never told apart twice.
 *
 * Only the article's own children count. A `data-block-id` on a nested
 * element is raw HTML an author wrote (`render.ts` lets a well-formed one
 * through), not a block — the server would refuse it, and a click inside
 * it must land on the block that actually holds it.
 */

/** Every block a thread can stand on, whichever identity it carries. */
export const COMMENTABLE_BLOCK_SELECTOR = ':scope > [data-block-id], :scope > [data-derived-block-id]';

/** The CSS selector matching the element that carries `blockId` under either spelling. */
export function blockSelector(blockId: string): string {
  const escaped = CSS.escape(blockId);
  return `:scope > [data-block-id="${escaped}"], :scope > [data-derived-block-id="${escaped}"]`;
}

/** The identity an element carries: the persisted one when it has it, the derived one otherwise, `null` for neither. */
export function blockIdOf(element: Element): string | null {
  return element.getAttribute('data-block-id') ?? element.getAttribute('data-derived-block-id');
}

/** The top-level block that contains `node`, if it carries an identity — the ancestor that is `root`'s own child. */
export function commentableBlockOf(node: Node | null, root: Element): HTMLElement | null {
  let current: Node | null = node;
  while (current && current.parentNode !== root) current = current.parentNode;
  if (!(current instanceof HTMLElement)) return null;
  return blockIdOf(current) === null ? null : current;
}

/**
 * The client-side twin of the mint the server just performed: the block
 * that carried `derivedId` now carries `persistedId` as its anchor, so the
 * thread the server returns under that id can be placed beside its text
 * before the page is reloaded and the real render arrives. Nothing else
 * in the cached HTML is touched, and a reload replaces all of it.
 */
export function adoptMintedAnchor(root: Element, derivedId: string, persistedId: string): void {
  const block = root.querySelector(`:scope > [data-derived-block-id="${CSS.escape(derivedId)}"]`);
  if (!block) return;
  block.setAttribute('data-block-id', persistedId);
  block.removeAttribute('data-derived-block-id');
}
