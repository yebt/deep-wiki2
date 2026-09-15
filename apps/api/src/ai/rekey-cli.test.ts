/**
 * The argv/environment shell of `bun run -F @deep-wiki/api ai:rekey`.
 * `rekeyAll` itself is tested in `rekey.test.ts` against a real database;
 * this drives the entry point as an operator would — a child process
 * with a controlled environment — and asserts the refusals it must make
 * before it ever opens a connection. No test here reaches a database.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, 'rekey-cli.ts');
// A 32-byte key, base64-encoded (Buffer.alloc(32, 7).toString('base64')).
const KEK = 'BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=';
const BASE_ENV = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };

function run(args: readonly string[], env: Record<string, string>): { exitCode: number; stderr: string; stdout: string } {
  const result = Bun.spawnSync(['bun', 'run', CLI, ...args], { env: { ...BASE_ENV, ...env }, stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stderr: result.stderr.toString(), stdout: result.stdout.toString() };
}

describe('ai:rekey — refusals before any database work', () => {
  test('refuses without DATABASE_URL', () => {
    const { exitCode, stderr } = run(['--to', 'k1'], {});

    expect(exitCode).toBe(1);
    expect(stderr).toContain('DATABASE_URL is not set');
  });

  test('refuses without AI_KEK_KEYRING', () => {
    const { exitCode, stderr } = run(['--to', 'k1'], { DATABASE_URL: 'postgres://u:p@localhost:1/db' });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('AI_KEK_KEYRING is not set');
  });

  test('refuses a keyring that does not parse, without echoing it', () => {
    const { exitCode, stderr } = run(['--to', 'k1'], {
      DATABASE_URL: 'postgres://u:p@localhost:1/db',
      AI_KEK_KEYRING: 'k1:tooshort',
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('AI_KEK_KEYRING failed to parse');
    expect(stderr).not.toContain('tooshort');
  });

  test('refuses without --to', () => {
    const { exitCode, stderr } = run([], { DATABASE_URL: 'postgres://u:p@localhost:1/db', AI_KEK_KEYRING: `k1:${KEK}` });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('--to <keyId> is required');
  });

  test('refuses a --to key id absent from the keyring', () => {
    const { exitCode, stderr } = run(['--to', 'k-retired'], {
      DATABASE_URL: 'postgres://u:p@localhost:1/db',
      AI_KEK_KEYRING: `k1:${KEK}`,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toContain('"k-retired" is not present in AI_KEK_KEYRING');
    expect(stderr).not.toContain(KEK);
  });
});
