import { describe, expect, test } from 'bun:test';
import { app } from './index';

describe('GET /health', () => {
  test('returns 200', async () => {
    const res = await app.request('/health');

    expect(res.status).toBe(200);
  });
});
