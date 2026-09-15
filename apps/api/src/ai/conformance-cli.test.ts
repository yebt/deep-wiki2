/**
 * `bun run -F @deep-wiki/api ai:conformance` with no provider key in the
 * environment: every wired model is reported as skipped — naming the
 * variable that would run it — and the run exits 0 without spending a
 * cent, because a skipped model is not a failed one. The suite itself is
 * tested in `conformance.test.ts` against recorded fixtures.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'conformance-cli.ts');

describe('ai:conformance with no provider key available', () => {
  const result = Bun.spawnSync(['bun', 'run', CLI], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = result.stdout.toString();

  test('exits cleanly', () => {
    expect(result.exitCode).toBe(0);
  });

  test('reports every wired provider as skipped, naming its key variable', () => {
    for (const [modelId, envVar] of [
      ['anthropic:claude-3-5-sonnet-20241022', 'AI_CONFORMANCE_ANTHROPIC_KEY'],
      ['openai:gpt-4o', 'AI_CONFORMANCE_OPENAI_KEY'],
      ['google:gemini-1.5-pro', 'AI_CONFORMANCE_GOOGLE_KEY'],
      ['deepseek:deepseek-chat', 'AI_CONFORMANCE_DEEPSEEK_KEY'],
      ['openrouter:meta-llama/llama-3.1-70b-instruct', 'AI_CONFORMANCE_OPENROUTER_KEY'],
    ]) {
      expect(stdout).toContain(`ai:conformance: ${modelId} — skipped (set ${envVar})`);
    }
  });

  test('runs no model, so no result line is printed', () => {
    expect(stdout).not.toContain('matched=');
  });
});
