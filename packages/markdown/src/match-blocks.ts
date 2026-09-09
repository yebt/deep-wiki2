import { createHash } from 'node:crypto';

/** A previously persisted block, as recorded in `page_blocks`. */
export interface PersistedBlockRecord {
  id: string;
  /** The block's last known canonical text, used only for similarity — the source of truth for content is the current document. */
  text: string;
}

export type BlockAssignmentStatus = 'active' | 'superseded' | 'tombstoned';

export interface BlockAssignment {
  id: string;
  status: BlockAssignmentStatus;
  /** The index into `next` this id now occupies, when `active`. */
  slot?: number;
  /** The surviving id, when `superseded`. */
  supersededBy?: string;
  /** The best score found for this id, for diagnostics and the threshold invariant. */
  score: number;
}

export interface MatchBlocksResult {
  assignments: BlockAssignment[];
  /**
   * Freshly minted ids for new fragments produced by a split, mapped to
   * their slot in `next` and the id of the block they split from
   * (page-content spec: "Page Blocks Record Split Provenance").
   */
  mintedIds: Array<{ id: string; slot: number; splitFrom: string }>;
}

/**
 * The refusal threshold below which a persisted id is never reassigned
 * (design.md D8). This is a deliberate, conservative judgement — not a
 * measurement — biased toward an orphaned anchor over a misattributed one:
 * a comment or citation that silently lands on the wrong block is worse
 * than one that visibly breaks, because the orphan is detectable and the
 * misattribution is not. See docs/TODO.md's matching Finding for the
 * reversal criterion (a measured mis-assignment rate at this threshold from
 * real edit traffic).
 */
export const MATCH_THRESHOLD = 0.5;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
}

/** Token trigrams of `text`; falls back to the whole token sequence when there are fewer than 3 tokens, so short blocks still compare meaningfully. */
function trigrams(text: string): Set<string> {
  const tokens = tokenize(text);
  if (tokens.length === 0) return new Set();
  if (tokens.length < 3) return new Set([tokens.join(' ')]);

  const set = new Set<string>();
  for (let i = 0; i <= tokens.length - 3; i++) {
    set.add(tokens.slice(i, i + 3).join(' '));
  }
  return set;
}

/**
 * Threshold for re-anchoring a comment to a block that no longer matches
 * exactly (versioning-and-collaboration design.md Decision 1, "The
 * confidence rule"). Deliberately stricter than `MATCH_THRESHOLD` (0.5):
 * a wrong block-identity match still yields *a block*, visible in the
 * block registry's own excerpt; a wrong comment re-anchor re-attaches a
 * person's words to text they did not write about, which
 * `docs/UI-CHECKLIST.md:143` forbids outright. Reversal criterion: a
 * measured orphan rate from real edit traffic, exactly as `MATCH_THRESHOLD`
 * states its own (see this file's doc comment above).
 */
export const ANCHOR_CONTAINMENT_THRESHOLD = 0.8;

/**
 * `|trigrams(a) ∩ trigrams(b)| / |trigrams(a)|` — asymmetric, unlike
 * `diceCoefficient`. Dice penalises size asymmetry, so a short quote
 * inside a long paragraph scores low no matter how intact it is;
 * containment asks the question actually being asked: is `a` still in
 * `b`? Exported for comment-anchor reconciliation, which asks exactly
 * that of a comment's stored `quote` against a candidate block's current
 * text (design.md Decision 1, "The confidence rule").
 */
export function trigramContainment(a: string, b: string): number {
  const trigramsA = trigrams(a);
  const trigramsB = trigrams(b);
  if (trigramsA.size === 0) return 0;

  let intersection = 0;
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) intersection++;
  }
  return intersection / trigramsA.size;
}

/** Dice coefficient over two trigram sets: `2 * |A ∩ B| / (|A| + |B|)`. */
function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  return (2 * intersection) / (a.size + b.size);
}

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // excludes I, L, O, U

/**
 * Mints a fresh 10-character Crockford base32 block id from
 * `crypto.getRandomValues`, checked unique against `existingIds`
 * (markdown-pipeline: Block IDs Are Assigned Lazily, minting scenario).
 */
export function mintBlockId(existingIds: ReadonlySet<string>): string {
  let candidate: string;
  do {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    candidate = Array.from(bytes, (byte) => CROCKFORD_ALPHABET[byte % CROCKFORD_ALPHABET.length]).join('');
  } while (existingIds.has(candidate));
  return candidate;
}

/**
 * The derived, in-index-only identity of an unreferenced block: stable
 * under edits above it, changes when the block's own content changes
 * (markdown-pipeline: Block IDs Are Assigned Lazily). `occurrenceIndex`
 * disambiguates identical sibling blocks (the n-th block with this exact
 * text).
 */
export function deriveBlockId(canonicalBlockText: string, occurrenceIndex: number): string {
  const hash = createHash('sha256').update(canonicalBlockText).digest('hex').slice(0, 12);
  return `d:${hash}#${occurrenceIndex}`;
}

/**
 * Matches every previously persisted block id against the current set of
 * block texts by Dice coefficient over token trigrams, and decides whether
 * each id stays `active`, is `superseded` by a merge, or is `tombstoned`
 * (design.md "Block identity" — Split, Merge, Delete, The threshold).
 *
 * The algorithm, in three passes:
 * 1. Each previous id picks its own best-scoring slot in `next`.
 * 2. Slots claimed by more than one id are a **merge**: the highest scorer
 *    survives `active`; the rest are `superseded`, pointing at the survivor.
 *    A claimant whose own best score never reaches the threshold is
 *    `tombstoned` instead of superseded.
 * 3. A surviving id whose row also scores at or above the threshold against
 *    an otherwise-unclaimed slot is a **split**: that id keeps its original
 *    slot, and each additional unclaimed slot mints a fresh id — the
 *    persisted id follows the fragment that best matches the original text,
 *    exactly once, and every other fragment gets a fresh identity rather
 *    than sharing the old one.
 */
export function matchBlocks(previous: PersistedBlockRecord[], next: string[]): MatchBlocksResult {
  const previousTrigrams = previous.map((block) => trigrams(block.text));
  const nextTrigrams = next.map((text) => trigrams(text));

  const scores: number[][] = previousTrigrams.map((prevSet) =>
    nextTrigrams.map((nextSet) => diceCoefficient(prevSet, nextSet)),
  );

  // Pass 1: each previous id's own best slot.
  const bestSlot: number[] = [];
  const bestScore: number[] = [];
  previous.forEach((_block, i) => {
    let winnerSlot = -1;
    let winnerScore = -1;
    scores[i]!.forEach((score, slot) => {
      if (score > winnerScore) {
        winnerScore = score;
        winnerSlot = slot;
      }
    });
    bestSlot.push(winnerSlot);
    bestScore.push(winnerScore);
  });

  // Pass 2: group by claimed slot, resolve merges.
  const claimantsBySlot = new Map<number, number[]>();
  previous.forEach((_block, i) => {
    if (bestScore[i]! < MATCH_THRESHOLD) return; // handled as tombstoned below
    const group = claimantsBySlot.get(bestSlot[i]!) ?? [];
    group.push(i);
    claimantsBySlot.set(bestSlot[i]!, group);
  });

  const assignments: BlockAssignment[] = [];
  const claimedSlots = new Set<number>();

  for (const [slot, claimants] of claimantsBySlot) {
    let survivorIndex = claimants[0]!;
    for (const i of claimants) {
      if (scores[i]![slot]! > scores[survivorIndex]![slot]!) survivorIndex = i;
    }
    claimedSlots.add(slot);

    for (const i of claimants) {
      if (i === survivorIndex) {
        assignments.push({ id: previous[i]!.id, status: 'active', slot, score: scores[i]![slot]! });
      } else {
        assignments.push({
          id: previous[i]!.id,
          status: 'superseded',
          supersededBy: previous[survivorIndex]!.id,
          score: scores[i]![slot]!,
        });
      }
    }
  }

  previous.forEach((block, i) => {
    if (bestScore[i]! < MATCH_THRESHOLD) {
      assignments.push({ id: block.id, status: 'tombstoned', score: bestScore[i]! });
    }
  });

  // Pass 3: splits. A real split's second fragment is not reliably similar
  // enough to the *whole* original text to clear MATCH_THRESHOLD on its own
  // (half a paragraph often shares only a little vocabulary with the
  // other half) — the reliable signal is that it sits immediately adjacent,
  // in document order, to the fragment that *did* win, and still shares at
  // least some content with the original (ruling out an unrelated
  // paragraph that merely happens to land next to a matched one).
  const mintedIds: Array<{ id: string; slot: number; splitFrom: string }> = [];
  const mintedSoFar = new Set(previous.map((b) => b.id));

  for (const assignment of assignments) {
    if (assignment.status !== 'active' || assignment.slot === undefined) continue;
    const i = previous.findIndex((block) => block.id === assignment.id);
    if (i === -1) continue;

    for (const adjacentSlot of [assignment.slot - 1, assignment.slot + 1]) {
      const score = scores[i]?.[adjacentSlot];
      if (score === undefined || score <= 0 || claimedSlots.has(adjacentSlot)) continue;

      const freshId = mintBlockId(mintedSoFar);
      mintedSoFar.add(freshId);
      claimedSlots.add(adjacentSlot);
      mintedIds.push({ id: freshId, slot: adjacentSlot, splitFrom: assignment.id });
      assignments.push({ id: freshId, status: 'active', slot: adjacentSlot, score });
    }
  }

  return { assignments, mintedIds };
}
