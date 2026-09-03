import { describe, expect, test } from 'bun:test';
import { loadConfig } from './config';

describe('loadConfig', () => {
  test('apps/landing requires zero environment variables in Phase 0', () => {
    expect(loadConfig({})).toEqual({});
  });

  test('is not affected by unrelated environment variables', () => {
    expect(loadConfig({ NODE_ENV: 'test', UNRELATED: 'value' })).toEqual({});
  });
});
