import { describe, expect, test } from 'bun:test';
import { createApp } from './index';

const WEB_ORIGIN = 'http://localhost:4173';

describe('GET /health', () => {
  test('returns 200', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/health');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  // Regression: /health was registered at module scope while the CORS
  // middleware was installed later, and Hono applies `use()` only to routes
  // registered after it. /health answered 200 with no Access-Control-Allow-Origin
  // and the browser refused to read it, while every other route worked.
  test('carries the CORS headers the browser needs, like every other route', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/health', {
      headers: { Origin: WEB_ORIGIN },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(WEB_ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('an origin that is not the configured app is not allowed', async () => {
    const res = await createApp({ appUrl: WEB_ORIGIN }).request('/health', {
      headers: { Origin: 'http://evil.example' },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('http://evil.example');
  });
});
