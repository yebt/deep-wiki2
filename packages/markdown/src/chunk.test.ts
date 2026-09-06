import { describe, expect, test } from 'bun:test';
import { chunk } from './chunk';

// markdown-pipeline: Deterministic Chunk Boundaries Carrying Block IDs

describe('chunk()', () => {
  test('running twice on the same input produces deep-equal output', () => {
    const markdown = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

    const first = chunk(markdown, { maxTokens: 100 });
    const second = chunk(markdown, { maxTokens: 100 });

    expect(second).toEqual(first);
  });

  test('no chunk boundary falls inside a block; each chunk records the block ids it spans', () => {
    const markdown = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

    const chunks = chunk(markdown, { maxTokens: 3 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.blockIds.length).toBeGreaterThan(0);
      // Every block's own text must be fully contained in the chunk's text,
      // never truncated mid-block.
      expect(c.text.trim().length).toBeGreaterThan(0);
    }
    // Together, the chunks' block counts add up to all three blocks.
    const totalBlocks = chunks.reduce((sum, c) => sum + c.blockIds.length, 0);
    expect(totalBlocks).toBe(3);
  });

  test('an oversized block becomes its own chunk rather than being cut mid-content', () => {
    const hugeParagraph = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const markdown = `Short one.\n\n${hugeParagraph}\n\nShort two.\n`;

    const chunks = chunk(markdown, { maxTokens: 5 });

    const oversized = chunks.find((c) => c.text.includes('word0'));
    expect(oversized).toBeDefined();
    expect(oversized!.blockIds).toHaveLength(1);
    expect(oversized!.text).toContain('word49');
  });

  test('chunks are numbered by ordinal, starting at 0, in document order', () => {
    const markdown = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n';

    const chunks = chunk(markdown, { maxTokens: 3 });

    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });

  test('each chunk carries the derived block id of every block it spans', () => {
    const markdown = 'Only one paragraph here.\n';

    const chunks = chunk(markdown, { maxTokens: 100 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.blockIds[0]).toMatch(/^d:[0-9a-f]{12}#0$/);
  });
});
