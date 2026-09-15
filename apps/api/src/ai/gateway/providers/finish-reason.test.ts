/**
 * `ChatFinishReason` (`packages/core/src/ai/ports.ts`) is a closed set
 * with no SDK vocabulary in it. The SDK's `'other'` catch-all folds to
 * `'error'`; everything else must pass through unchanged, so a port
 * consumer can rely on the value it reads being the one the SDK meant.
 */
import { describe, expect, test } from 'bun:test';
import { mapFinishReason } from './finish-reason';

describe('mapFinishReason', () => {
  test("the SDK's 'other' catch-all folds to 'error'", () => {
    expect(mapFinishReason('other')).toBe('error');
  });

  test('every named reason passes through unchanged', () => {
    for (const reason of ['stop', 'length', 'content-filter', 'tool-calls', 'error'] as const) {
      expect(mapFinishReason(reason)).toBe(reason);
    }
  });
});
