import { describe, expect, test } from 'bun:test';
import { createDb } from './client';

describe('createDb', () => {
  test('returns a client without connecting (no live database in this test)', () => {
    // postgres.js is lazy: constructing a client issues no network I/O
    // until the first query. This URL is intentionally unreachable —
    // if createDb() connected eagerly, this test would hang or throw.
    const db = createDb('postgres://user:pass@localhost:1/does_not_exist');

    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
  });
});
