/**
 * Mints a fresh persisted anchor onto a block that currently carries only
 * a derived identity (comment-overlay spec: "A Comment On An Unanchored
 * Block Mints And Persists An Anchor"). Reuses the exact serialisation
 * shape `blockAnchorToMarkdown`/`applyBlockAnchors` already round-trip
 * (GATE-2) — this inserts the same literal ` ^id` text directly at the
 * block's own end offset rather than constructing a second path to the
 * same output.
 *
 * **The splice is not canonical by itself.** Both directions here edit
 * Markdown *source* by byte offset, and a block's last bytes are exactly
 * where a spelling can depend on what follows them. A paragraph ending in a
 * space is canonically spelled with that space escaped —
 * `This is a content&#x20;` — because unescaped trailing whitespace does not
 * survive a reparse. Append ` ^id` and the space is no longer trailing, so
 * canonical form spells it literally; remove the anchor and the space stops
 * being representable at all. The splice cannot know either, so both
 * functions return `canonicalise()` of their spliced result rather than
 * assuming the splice preserved canonical form.
 *
 * That is not cosmetic. `savePage()` refuses Markdown that is not its own
 * fixed point (design.md D1), so a splice returning non-canonical bytes is a
 * refusal of its own caller's write: it surfaced as a 500 on
 * `POST /pages/:id/comments` for any page whose commented block ended in an
 * escaped space, and as an unsavable `corrected` document on the dead-anchor
 * refusal (docs/TODO.md, 2026-09-23). `canonicalise` is idempotent by
 * construction, so the result is a fixed point for any input; when the input
 * was canonical — which stored page Markdown is, by construction — the only
 * bytes that differ from the raw splice are the ones whose spelling the
 * splice itself invalidated.
 */
import { mintBlockId } from './match-blocks';
import { canonicalise, parse } from './pipeline';
import { sliceBlocks, type BlockSlice } from './blocks';

export interface MintAnchorResult {
  readonly markdown: string;
  readonly blockId: string;
}

/**
 * Finds the block whose current id (persisted anchor, or derived identity
 * when unanchored) equals `targetBlockId`. If it already carries a
 * persisted anchor, returns the markdown unchanged. Otherwise mints a
 * fresh id, appends ` ^<id>` at the block's own end offset, and returns
 * the mutated markdown. Returns `null` when no block matches.
 *
 * `reservedIds` are ids the mint must avoid that this document cannot
 * show: the anchors currently written into `markdown` are the *live* ids
 * only, so a page's tombstoned and superseded ids are invisible here.
 * Callers holding the registry's full id set for the page — every status —
 * pass it, so the exclusion set is a mechanism rather than a bet on the
 * 32^10 id space (markdown-pipeline: "A tombstoned ID MUST NOT be reused
 * for a new block").
 */
export function mintAnchorAtBlock(markdown: string, targetBlockId: string, reservedIds?: ReadonlySet<string>): MintAnchorResult | null {
  const tree = parse(markdown);
  const slices: BlockSlice[] = sliceBlocks(tree, markdown);
  const index = slices.findIndex((slice) => slice.id === targetBlockId);
  if (index === -1) return null;

  const slice = slices[index]!;
  if (slice.anchorId) {
    return { markdown, blockId: slice.anchorId };
  }

  const existingIds = new Set(slices.filter((s): s is BlockSlice & { anchorId: string } => s.anchorId !== null).map((s) => s.anchorId));
  if (reservedIds) for (const id of reservedIds) existingIds.add(id);
  const newId = mintBlockId(existingIds);

  const node = tree.children[index]!;
  const end = node.position!.end.offset!;
  const spliced = `${markdown.slice(0, end)} ^${newId}${markdown.slice(end)}`;

  // Canonicalised, never returned raw — see "the splice is not canonical by
  // itself" in this file's header.
  return { markdown: canonicalise(spliced), blockId: newId };
}

/**
 * Removes the trailing ` ^<id>` anchor from every block whose anchor is in
 * `ids`, leaving every other byte of `markdown` untouched *except* where
 * removing the anchor changed a spelling's canonical form — see the header.
 * The exact inverse of the splice `mintAnchorAtBlock` performs above,
 * deliberately in the same module: the literal on-disk shape of an anchor is
 * known in one place, so the two directions cannot drift apart.
 *
 * This is the correction the save path hands back when a document
 * reintroduces an id the registry has already retired
 * (`packages/db/src/content/rebuild-derived.ts`'s `DeadAnchorError`).
 * Removing the dead anchor rather than re-minting a fresh one is what
 * "Block IDs Are Assigned Lazily" already prescribes: the pasted text is a
 * new block that nothing references yet, so it should carry no persisted
 * id at all until something — a comment, a citation — asks for one. Minting
 * eagerly here would invent an identity for a block nobody has referenced.
 */
export function stripBlockAnchors(markdown: string, ids: ReadonlySet<string>): string {
  if (ids.size === 0) return markdown;

  const tree = parse(markdown);
  const slices: BlockSlice[] = sliceBlocks(tree, markdown);

  // Spliced back-to-front so every offset still indexes the original
  // string: each removal only ever shifts bytes after it.
  let result = markdown;
  for (let index = slices.length - 1; index >= 0; index--) {
    const anchorId = slices[index]!.anchorId;
    if (anchorId === null || !ids.has(anchorId)) continue;

    const end = tree.children[index]!.position?.end.offset;
    if (end === undefined) continue;
    const suffix = ` ^${anchorId}`;
    const start = end - suffix.length;
    if (start < 0 || result.slice(start, end) !== suffix) continue;

    result = result.slice(0, start) + result.slice(end);
  }
  // Canonicalised for the same reason the mint is, and it matters more here:
  // this document is handed straight back to a client as the version to
  // re-submit, so non-canonical bytes would make the correction unsavable.
  return canonicalise(result);
}
