import { expect, test } from 'bun:test';
import type { CommentAnchor } from './comment';

// versioning-and-collaboration design.md Decision 1 ("The comment anchor
// mechanism"): quote is the load-bearing field, offsets are a fast path.

test('an anchored CommentAnchor carries its quote and offsets', () => {
  const anchor: CommentAnchor = {
    blockId: 'abc123',
    offsetStart: 10,
    offsetEnd: 42,
    quote: 'the exact text the comment was written about',
    quoteHash: 'hash-1',
    status: 'anchored',
  };

  expect(anchor.status).toBe('anchored');
  expect(anchor.quote).toBe('the exact text the comment was written about');
});

test('an orphaned CommentAnchor keeps its original quote unchanged', () => {
  const anchor: CommentAnchor = {
    blockId: 'abc123',
    offsetStart: 10,
    offsetEnd: 42,
    quote: 'text that no longer exists anywhere in the page',
    quoteHash: 'hash-2',
    status: 'orphaned',
  };

  expect(anchor.status).toBe('orphaned');
  expect(anchor.quote).toBe('text that no longer exists anywhere in the page');
});
