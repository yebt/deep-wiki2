import { describe, expect, test } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  test('apps/web requires zero environment variables in Phase 0', () => {
    expect(loadConfig({})).toEqual({});
  });

  test('is not affected by unrelated environment variables', () => {
    expect(loadConfig({ NODE_ENV: 'test', UNRELATED: 'value' })).toEqual({});
  });
});
