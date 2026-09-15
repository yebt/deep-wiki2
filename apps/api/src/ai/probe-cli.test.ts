/**
 * `bun run -F @deep-wiki/api ai:probe` with no provider key in the
 * environment. The contract under test is the honest one the 2026-09-06
 * Finding relies on: an unrun probe reports `unknown` — never
 * `unsupported`, never `supported` — names the variable that would have
 * run it, and touches no network.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'probe-cli.ts');

describe('ai:probe with no provider key available', () => {
  const result = Bun.spawnSync(['bun', 'run', CLI], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = result.stdout.toString();

  test('exits cleanly — an unrun probe is not a failure', () => {
    expect(result.exitCode).toBe(0);
  });

  test('reports every probed provider as unknown, naming the key variable that would run it', () => {
    for (const [provider, envVar] of [
      ['openai', 'AI_PROBE_OPENAI_KEY'],
      ['google', 'AI_PROBE_GOOGLE_KEY'],
      ['openrouter', 'AI_PROBE_OPENROUTER_KEY'],
    ]) {
      expect(stdout).toContain(`ai:probe: ${provider} embeddings — supported=unknown`);
      expect(stdout).toContain(`set ${envVar}`);
    }
  });

  test('never claims a provider is supported or unsupported without running', () => {
    expect(stdout).not.toContain('supported=true');
    expect(stdout).not.toContain('supported=false');
  });
});
