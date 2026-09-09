/**
 * A node's URL slug, derived from the title the user typed.
 *
 * The slug is the second half of `nodes_parent_slug_unique (parent_id,
 * slug)` — the pair `packages/db/seed.ts` looks a node up by — and the
 * column carries no shape CHECK of its own, so this function is the only
 * thing between a free-text title and a stored row. Apostrophes, slashes
 * and em dashes are ordinary in a page title and impossible in a slug.
 *
 * Deliberately *not* uniquified here. Making `overview` into `overview-2`
 * would need to know the siblings, which is a database question, and
 * answering it silently would give the user a node under a name they did
 * not choose. `packages/db/src/nodes/create.ts` refuses the collision
 * instead, and says so.
 */

/** Comfortably inside `nodes_path_length_chk`'s budget and short enough to read in a URL. */
export const MAX_SLUG_LENGTH = 96;

export function slugifyTitle(title: string): string {
  const folded = title
    // NFD splits an accented letter into letter + combining mark, so the
    // marks can be removed without taking the letter with them — "diseño"
    // becomes "diseno" rather than "disen".
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  const hyphenated = folded.replace(/[^a-z0-9]+/g, '-');
  const trimmed = trimHyphens(hyphenated);

  return trimHyphens(trimmed.slice(0, MAX_SLUG_LENGTH));
}

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '');
}
