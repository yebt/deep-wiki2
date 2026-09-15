/**
 * The environment `e2e/global-setup.ts` hands the `apps/api` child
 * process must be one `loadConfig()` accepts — with nothing borrowed from
 * whatever `.env` happens to be loaded in the runner's own shell.
 *
 * Found on 2026-09-15 integrating `ai-provider-foundation`: `refineEnv()`
 * now requires `AI_KEK_KEYRING` and `AI_KEK_ACTIVE_ID` under the default
 * `AI_KEK_DRIVER=env`, exactly as it had come to require
 * `CHANGESET_WINDOW_MINUTES` while that branch was in flight. The harness
 * spread `process.env` and named every other required variable
 * explicitly, so on a machine whose `.env` predates the AI variables — or
 * a fresh worktree with no `.env` at all — every e2e run died in
 * `loadConfig()` before the first spec. This test holds the harness's
 * env to the same contract the server enforces, so the next required
 * variable fails here rather than in a browser run.
 */
import { describe, expect, test } from 'bun:test';
import { parseEnv } from '@deep-wiki/contracts';
import { apiProcessEnv } from '../../../e2e/global-setup';

const INPUT = { databaseUrl: 'postgres://user:pass@localhost:5432/dw_test_1', blobRoot: '/tmp/blobs' };

describe('the env e2e/global-setup.ts spawns apps/api with', () => {
  test('satisfies loadConfig() on its own, with nothing inherited from the runner shell', () => {
    const env = apiProcessEnv(INPUT, {});
    const result = parseEnv(env);

    expect(result.ok).toBe(true);
    if (result.ok) return;
    // Name the variable, so a future required addition to env.ts reads
    // as "add it to apiProcessEnv", not as a Playwright failure.
    throw new Error(result.error.map((issue) => `${issue.variable}: ${issue.message}`).join('\n'));
  });

  test('carries the AI envelope keyring the credential route boots against', () => {
    const env = apiProcessEnv(INPUT, {});

    expect(env.AI_KEK_KEYRING).toBeDefined();
    expect(env.AI_KEK_ACTIVE_ID).toBeDefined();
  });

  test('the harness values win over a stale or conflicting runner .env', () => {
    const env = apiProcessEnv(INPUT, { DATABASE_URL: 'postgres://elsewhere', AI_KEK_ACTIVE_ID: 'not-in-keyring' });

    expect(env.DATABASE_URL).toBe(INPUT.databaseUrl);
    expect(parseEnv(env).ok).toBe(true);
  });
});
