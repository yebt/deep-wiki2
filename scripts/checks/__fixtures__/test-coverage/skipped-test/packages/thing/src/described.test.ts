import { describe, expect, it } from 'bun:test';
import { described } from './described';

describe.skip('a skipped suite', () => {
  it('never runs', () => {
    expect(described()).toBe(4);
  });
});
