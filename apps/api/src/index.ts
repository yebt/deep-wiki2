import { Hono } from 'hono';
import { loadConfig } from './config';

export const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));

// Config is only loaded (and can only fail fast) when this module is run
// as the actual server entry point — not merely imported, e.g. by tests
// exercising `app` directly against an in-memory request.
if (import.meta.main) {
  const config = loadConfig();
  console.log(`apps/api: listening on port ${config.PORT}`);
  Bun.serve({ port: config.PORT, fetch: app.fetch });
}
