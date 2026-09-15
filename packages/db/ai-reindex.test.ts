/**
 * The argv/environment shell of `bun run -F @deep-wiki/db ai:reindex`.
 * `startReindex`/`completeReindex` are tested in `src/ai/reindex.test.ts`
 * against a real database; this drives the entry point as an operator
 * would and asserts the refusals it makes before it runs a query. Every
 * case here exits before any connection is opened (`postgres()` connects
 * lazily), so no test reaches a database.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'ai-reindex.ts');
const BASE_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
const DATABASE_URL = 'postgres://u:p@localhost:1/db';

function run(args: readonly string[], env: Record<string, string>): { exitCode: number; stderr: string } {
  const result = Bun.spawnSync(['bun', 'run', CLI, ...args], { env: { ...BASE_ENV, ...env }, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

describe('ai:reindex — refusals before any database work', () => {
  test('refuses without DATABASE_URL', () => {
    const { exitCode, stderr } = run(['start'], {});

    expect(exitCode).toBe(1);
    expect(stderr).toContain('DATABASE_URL is not set');
  });

  test('refuses an unknown subcommand', () => {
    const { exitCode, stderr } = run(['rebuild'], { DATABASE_URL });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('expected a "start" or "complete" subcommand');
  });

  test('start refuses without --workspace, --provider and --model', () => {
    const { exitCode, stderr } = run(['start', '--workspace', 'ws1'], { DATABASE_URL });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--workspace, --provider and --model are required');
  });

  test('complete refuses without --job', () => {
    const { exitCode, stderr } = run(['complete'], { DATABASE_URL });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--job is required');
  });
});
