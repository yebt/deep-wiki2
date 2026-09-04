import { describe, expect, test } from 'bun:test';
import { decide } from './decide';

describe('decide', () => {
  test('is total: no grants resolves to deny', () => {
    expect(decide([])).toBe('deny');
  });

  test('the grant at the smallest depth wins over a grant further up the chain', () => {
    const result = decide([
      { depth: 2, effect: 'deny' },
      { depth: 0, effect: 'allow' },
    ]);
    expect(result).toBe('allow');
  });

  test('a farther deny does not override a nearer allow', () => {
    const result = decide([
      { depth: 0, effect: 'allow' },
      { depth: 3, effect: 'deny' },
    ]);
    expect(result).toBe('allow');
  });

  test('deny wins over allow at equal depth, regardless of which subject carried it (D8)', () => {
    const result = decide([
      { depth: 1, effect: 'allow' },
      { depth: 1, effect: 'deny' },
    ]);
    expect(result).toBe('deny');
  });

  test('deny wins at equal depth independent of array order', () => {
    const result = decide([
      { depth: 1, effect: 'deny' },
      { depth: 1, effect: 'allow' },
    ]);
    expect(result).toBe('deny');
  });
});
