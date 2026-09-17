/**
 * Word-level changes inside one edited block — what a `modified` block
 * shows *within* itself, on top of the four block classes the block-diff
 * spec fixes (added, removed, modified, moved). The block classes are
 * `diffBlocks()`'s in `packages/markdown`; this is the pure half that
 * needs no parser: two strings in, a list of segments out. It lives in
 * `packages/core` because it has nothing to import — zero framework
 * imports, machine-enforced by `scripts/checks/core-purity.ts`.
 *
 * Granularity is the word, never the character: "colour" → "color" is one
 * deleted word and one inserted word, which is what a reader can act on.
 * Whitespace runs and single punctuation marks are tokens of their own,
 * so a reflowed sentence marks the words that changed and not the whole
 * line, and so that both sides reassemble byte-for-byte from the segments
 * (`inline-diff.test.ts` holds that invariant). The block-diff spec's ban
 * on a text/line differ is about *block* classification — it exists so
 * "moved" survives — and is untouched: this runs only inside a block the
 * block differ has already matched as one block on both sides.
 */

/** One run of text inside an edited block, as it reads on one side or both. */
export interface InlineSegment {
  readonly kind: 'equal' | 'inserted' | 'deleted';
  readonly text: string;
}

/**
 * Words (letters, digits and `_`, in any script), whitespace runs, and
 * every other character on its own — the three classes together cover
 * every code point, so the tokens concatenate back to the input exactly.
 */
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

export function tokenizeInline(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

type Op = 'equal' | 'inserted' | 'deleted';

/**
 * Myers' O(ND) shortest edit script over the two token arrays
 * (E. Myers, "An O(ND) Difference Algorithm and Its Variations", 1986),
 * the forward greedy form with the per-D frontier kept for the trace
 * back. D is the number of tokens that differ, so an ordinary edit to a
 * paragraph costs a handful of diagonals; a full rewrite of a 2000-token
 * block is the worst case and still finishes in tens of milliseconds.
 */
function shortestEditOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  // `trace[d]` is the frontier after `d` edits, indexed by `k + offset`.
  const trace: Int32Array[] = [];
  let v = new Int32Array(2 * max + 2);
  v[offset + 1] = 0;

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v);
    const next = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!; // down: an insertion
      } else {
        x = v[offset + k - 1]! + 1; // right: a deletion
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }

  // Trace back from (n, m) through each frontier to (0, 0).
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const frontier = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = frontier[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('equal');
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        ops.push('inserted');
        y--;
      } else {
        ops.push('deleted');
        x--;
      }
    }
  }
  ops.reverse();
  return ops;
}

interface ChangedRun {
  readonly kind: 'changed';
  deleted: string;
  inserted: string;
}

interface EqualRun {
  readonly kind: 'equal';
  text: string;
}

type Run = ChangedRun | EqualRun;

const WHITESPACE_ONLY = /^\s+$/;

/**
 * Gathers the edit script into runs: an `equal` run per stretch of
 * common tokens, a `changed` run per stretch of edits with its deleted
 * and inserted text kept apart.
 */
function gatherRuns(a: readonly string[], b: readonly string[], ops: readonly Op[]): Run[] {
  const runs: Run[] = [];
  let ai = 0;
  let bi = 0;
  const last = (): Run | undefined => runs[runs.length - 1];
  for (const op of ops) {
    if (op === 'equal') {
      const token = a[ai]!;
      const tail = last();
      if (tail?.kind === 'equal') tail.text += token;
      else runs.push({ kind: 'equal', text: token });
      ai++;
      bi++;
      continue;
    }
    let tail = last();
    if (tail?.kind !== 'changed') {
      tail = { kind: 'changed', deleted: '', inserted: '' };
      runs.push(tail);
    }
    if (op === 'deleted') {
      tail.deleted += a[ai]!;
      ai++;
    } else {
      tail.inserted += b[bi]!;
      bi++;
    }
  }
  return runs;
}

/**
 * Two changed runs separated by nothing but whitespace read as one
 * change: "no edits yet" → "one small edit" is three words on each side,
 * and marking each word on its own ("[no→one] [edits→small] [yet→edit]")
 * is exact but not what a person means by "what changed". The shared
 * whitespace is folded into both sides — each side still reassembles —
 * whenever the two neighbours between them carry both a deletion and an
 * insertion, so the fold never manufactures a mark that is only a space.
 */
function foldWhitespaceBetweenChanges(runs: readonly Run[]): Run[] {
  const folded: Run[] = [];
  for (const run of runs) {
    const previous = folded[folded.length - 1];
    const beforePrevious = folded[folded.length - 2];
    if (
      run.kind === 'changed' &&
      previous?.kind === 'equal' &&
      WHITESPACE_ONLY.test(previous.text) &&
      beforePrevious?.kind === 'changed' &&
      (beforePrevious.deleted.length > 0 || run.deleted.length > 0) &&
      (beforePrevious.inserted.length > 0 || run.inserted.length > 0)
    ) {
      folded.pop();
      beforePrevious.deleted += previous.text + run.deleted;
      beforePrevious.inserted += previous.text + run.inserted;
      continue;
    }
    folded.push(run.kind === 'changed' ? { ...run } : { ...run });
  }
  return folded;
}

/**
 * The word-level difference between the two sides of one edited block.
 * Segments come in reading order; consecutive segments never share a
 * kind; within one changed run, the deletion precedes the insertion.
 * Concatenating every non-`inserted` segment gives `before`, every
 * non-`deleted` segment gives `after`.
 */
export function diffInline(before: string, after: string): InlineSegment[] {
  if (before === after) return before.length === 0 ? [] : [{ kind: 'equal', text: before }];

  const a = tokenizeInline(before);
  const b = tokenizeInline(after);
  const runs = foldWhitespaceBetweenChanges(gatherRuns(a, b, shortestEditOps(a, b)));

  const segments: InlineSegment[] = [];
  for (const run of runs) {
    if (run.kind === 'equal') {
      segments.push({ kind: 'equal', text: run.text });
      continue;
    }
    if (run.deleted) segments.push({ kind: 'deleted', text: run.deleted });
    if (run.inserted) segments.push({ kind: 'inserted', text: run.inserted });
  }
  return segments;
}
