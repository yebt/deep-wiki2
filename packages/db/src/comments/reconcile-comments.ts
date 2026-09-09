/**
 * Save-time comment-anchor reconciliation (comment-threads spec:
 * "Save-Time Reconciliation Resolves Every Anchor Per Block Transition";
 * versioning-and-collaboration design.md Decision 1, "The confidence
 * rule"). Runs as a third step inside `reconcileDerived`, after
 * `reconcileBlocks` and `compressChains`, consuming `reconcileBlocks`'s own
 * `{ assignments, mintedIds, nextBlocks }` rather than re-slicing or
 * re-matching the document — matching it twice would be the same fact
 * computed in two places.
 *
 * `assignments`/`mintedIds` — not `nextBlocks[i].anchorId` — are what map a
 * persisted id to its current text: a block can survive a merge (or a
 * split) as a *persisted* id via `matchBlocks`'s own similarity matching
 * with no literal ` ^id` marker written back into the current Markdown at
 * all (`sliceBlocks` reports `anchorId: null` for such a slot even though
 * `page_blocks` — and this reconciliation — correctly track it as that
 * exact surviving id).
 *
 * The confidence table, in order:
 *   1. Tombstoned block                -> orphan, unconditionally.
 *   2. Quote exact substring of B' at the stored offset -> migrate, offsets unchanged.
 *   3. Quote exact substring elsewhere, exactly once     -> migrate to that index.
 *   4. Quote occurs more than once                       -> migrate to the nearest occurrence.
 *   5. No exact match: trigramContainment over B' and every block whose
 *      split_from = B'; highest score >= 0.8 wins (a tie orphans, by design).
 *   Anything else -> orphan.
 *
 * Orphaning is one-way (comment-threads spec: "An orphaned comment is
 * never re-anchored by a later save") — only `status = 'anchored'` root
 * comments are ever read here.
 */
import { ANCHOR_CONTAINMENT_THRESHOLD, trigramContainment, type BlockAssignment, type BlockSlice } from '@deep-wiki/markdown';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ReconcileCommentsInput {
  readonly nodeId: string;
  /** `reconcileBlocks`'s own `matchBlocks` result — the source of truth for which id now owns which slot. */
  readonly assignments: readonly BlockAssignment[];
  readonly mintedIds: ReadonlyArray<{ id: string; slot: number; splitFrom: string }>;
  /** This exact save's full block set, sliced fresh from the current document. */
  readonly nextBlocks: readonly BlockSlice[];
}

/**
 * Every persisted id's current text, keyed by id — combining `assignments`
 * (ids that survived, whether by an unchanged slot or a merge), `mintedIds`
 * (freshly split fragments), and any block `nextBlocks` reports with a
 * literal anchor that neither of those two covers (first-time
 * registration: an anchor already written into the Markdown with no prior
 * `page_blocks` row at all).
 */
function buildTextByBlockId(
  assignments: readonly BlockAssignment[],
  mintedIds: ReadonlyArray<{ id: string; slot: number; splitFrom: string }>,
  nextBlocks: readonly BlockSlice[],
): Map<string, string> {
  const nextTexts = nextBlocks.map((block) => block.text);
  const textByBlockId = new Map<string, string>();

  for (const assignment of assignments) {
    if (assignment.status === 'active' && assignment.slot !== undefined) {
      textByBlockId.set(assignment.id, nextTexts[assignment.slot]!);
    }
  }
  for (const minted of mintedIds) {
    textByBlockId.set(minted.id, nextTexts[minted.slot]!);
  }
  for (const block of nextBlocks) {
    if (block.anchorId && !textByBlockId.has(block.anchorId)) {
      textByBlockId.set(block.anchorId, block.text);
    }
  }

  return textByBlockId;
}

interface AnchoredRoot {
  id: string;
  block_id: string;
  offset_start: number;
  offset_end: number;
  quote: string;
}

type ReconcileOutcome =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'orphan' }
  | { readonly kind: 'migrate'; readonly blockId: string; readonly offsetStart: number; readonly offsetEnd: number };

/** Every index at which `needle` occurs in `haystack` (non-overlapping search, left to right). */
function allIndicesOf(haystack: string, needle: string): number[] {
  if (needle.length === 0) return [];
  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    indices.push(index);
    from = index + needle.length;
  }
  return indices;
}

/** The occurrence closest to `target` by absolute distance; ties favour the earliest occurrence. */
function nearestOccurrence(indices: readonly number[], target: number): number {
  return indices.reduce((best, index) => (Math.abs(index - target) < Math.abs(best - target) ? index : best));
}

/** Confidence-table rows 2-4: the quote is still an exact substring of the survivor's own current text, at the old offset, elsewhere once, or at the nearest of several occurrences. `null` when none apply — row 5 takes over. */
function matchExactSubstring(survivorText: string, survivorId: string, root: AnchoredRoot): ReconcileOutcome | null {
  const atOldOffset = survivorText.slice(root.offset_start, root.offset_end);
  if (atOldOffset === root.quote) {
    return survivorId === root.block_id
      ? { kind: 'unchanged' }
      : { kind: 'migrate', blockId: survivorId, offsetStart: root.offset_start, offsetEnd: root.offset_end };
  }

  const occurrences = allIndicesOf(survivorText, root.quote);
  if (occurrences.length === 1) {
    return { kind: 'migrate', blockId: survivorId, offsetStart: occurrences[0]!, offsetEnd: occurrences[0]! + root.quote.length };
  }
  if (occurrences.length > 1) {
    const nearest = nearestOccurrence(occurrences, root.offset_start);
    return { kind: 'migrate', blockId: survivorId, offsetStart: nearest, offsetEnd: nearest + root.quote.length };
  }

  return null;
}

/** Confidence-table row 5: no exact match anywhere in the survivor's own text — score it and every block split from it, and take the highest. A tie at the top orphans rather than guessing between two equally-plausible fragments. */
async function matchByContainment(
  tx: SqlExecutor,
  nodeId: string,
  survivorId: string,
  root: AnchoredRoot,
  textByBlockId: ReadonlyMap<string, string>,
): Promise<ReconcileOutcome> {
  const splitRows = await tx<{ block_id: string }[]>`
    SELECT block_id FROM page_blocks WHERE page_id = ${nodeId} AND split_from = ${survivorId} AND status = 'active'
  `;
  const candidateIds = [survivorId, ...splitRows.map((row) => row.block_id)];

  let bestScore = -1;
  let bestCandidate: string | null = null;
  let tie = false;
  for (const candidateId of candidateIds) {
    const candidateText = textByBlockId.get(candidateId);
    if (candidateText === undefined) continue;
    const score = trigramContainment(root.quote, candidateText);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidateId;
      tie = false;
    } else if (score === bestScore) {
      tie = true;
    }
  }

  if (!bestCandidate || tie || bestScore < ANCHOR_CONTAINMENT_THRESHOLD) {
    return { kind: 'orphan' };
  }

  const candidateText = textByBlockId.get(bestCandidate)!;
  const exactIndex = candidateText.indexOf(root.quote);
  if (exactIndex !== -1) {
    return { kind: 'migrate', blockId: bestCandidate, offsetStart: exactIndex, offsetEnd: exactIndex + root.quote.length };
  }
  // No exact substring anywhere in the winning candidate either — the best
  // available window is the candidate's whole text; precise sub-window
  // alignment for a purely fuzzy match is out of scope here.
  return { kind: 'migrate', blockId: bestCandidate, offsetStart: 0, offsetEnd: candidateText.length };
}

async function resolveOneAnchor(
  tx: SqlExecutor,
  nodeId: string,
  root: AnchoredRoot,
  textByBlockId: ReadonlyMap<string, string>,
): Promise<ReconcileOutcome> {
  const [blockRow] = await tx<{ status: string; superseded_by: string | null }[]>`
    SELECT status, superseded_by FROM page_blocks WHERE page_id = ${nodeId} AND block_id = ${root.block_id}
  `;

  // Confidence-table row 1: tombstoned, unconditionally.
  if (!blockRow || blockRow.status === 'tombstoned') {
    return { kind: 'orphan' };
  }

  // `compressChains` already ran: `superseded_by` is the compressed,
  // active terminal — never an intermediate hop.
  const survivorId = blockRow.status === 'superseded' ? blockRow.superseded_by! : root.block_id;
  const survivorText = textByBlockId.get(survivorId);
  if (survivorText === undefined) {
    return { kind: 'orphan' };
  }

  return matchExactSubstring(survivorText, survivorId, root) ?? (await matchByContainment(tx, nodeId, survivorId, root, textByBlockId));
}

export async function reconcileComments(tx: SqlExecutor, input: ReconcileCommentsInput): Promise<void> {
  const roots = await tx<AnchoredRoot[]>`
    SELECT id, block_id, offset_start, offset_end, quote FROM comments
     WHERE page_id = ${input.nodeId} AND parent_id IS NULL AND status = 'anchored'
  `;
  if (roots.length === 0) return;

  const textByBlockId = buildTextByBlockId(input.assignments, input.mintedIds, input.nextBlocks);

  for (const root of roots) {
    const outcome = await resolveOneAnchor(tx, input.nodeId, root, textByBlockId);

    if (outcome.kind === 'orphan') {
      // One-way: never re-evaluated by a later save (see module doc comment).
      await tx`UPDATE comments SET status = 'orphaned' WHERE id = ${root.id}`;
    } else if (outcome.kind === 'migrate') {
      await tx`
        UPDATE comments SET block_id = ${outcome.blockId}, offset_start = ${outcome.offsetStart}, offset_end = ${outcome.offsetEnd}
         WHERE id = ${root.id}
      `;
    }
    // 'unchanged' -> no write.
  }
}
