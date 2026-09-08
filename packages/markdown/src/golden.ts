/**
 * The golden-file contract for this package's fixture-driven tests.
 *
 * A golden file is only evidence because a human read it once and committed
 * it. A suite that writes its own missing goldens has no such evidence: the
 * first run of a new fixture manufactures the expectation from whatever the
 * code happened to produce, so the test cannot fail, and every later run
 * merely confirms that the code still agrees with itself. That is this
 * repository's named recurring failure mode — a test passing for the wrong
 * reason — and this module closes it in both directions:
 *
 * - reading never writes, in any mode, so a missing golden is a hard error
 *   on the ordinary `bun test` path;
 * - writing and deleting are refused unless `UPDATE_CHUNK_GOLDENS=1` is set,
 *   which is a human running `bun run -F @deep-wiki/markdown goldens:update`
 *   on purpose and reading the resulting diff before committing it. The gate
 *   lives here rather than at each call site, so "the ordinary test run never
 *   writes a golden" is a property of this module instead of a convention
 *   every caller has to remember.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Environment variable that unlocks the deliberate regeneration path. */
export const REGENERATE_ENV = 'UPDATE_CHUNK_GOLDENS';

/** The command a human runs to regenerate; quoted in every refusal message. */
export const REGENERATE_COMMAND = 'bun run -F @deep-wiki/markdown goldens:update';

/** The subset of `process.env` this module reads, so tests need not mutate it. */
export type GoldenEnv = Record<string, string | undefined>;

/** Whether the caller explicitly asked for goldens to be rewritten. */
export function isRegenerating(env: GoldenEnv = process.env): boolean {
  return env[REGENERATE_ENV] === '1';
}

function refuseUnlessRegenerating(action: string, env: GoldenEnv): void {
  if (isRegenerating(env)) return;
  throw new Error(
    `Refusing to ${action}: goldens are only rewritten on purpose. Run \`${REGENERATE_COMMAND}\`, then read the diff before committing it.`,
  );
}

/**
 * Reads a committed golden. Throws — never writes, never returns a
 * placeholder — when the golden is absent, so a fixture added without a
 * reviewed golden fails the suite instead of quietly acquiring one.
 */
export function readGolden(dir: string, name: string): unknown {
  const path = join(dir, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing golden \`${name}\`: no reviewed expectation exists for this fixture. A golden is only evidence if a human read it, so this run will not write one. Run \`${REGENERATE_COMMAND}\`, read the generated file, and commit it.`,
    );
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Writes a golden as pretty JSON with a trailing newline, for a readable diff. */
export function writeGolden(
  dir: string,
  name: string,
  value: unknown,
  env: GoldenEnv = process.env,
): void {
  refuseUnlessRegenerating(`write golden \`${name}\``, env);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Goldens on disk that `expected` does not account for — the leftovers of a
 * renamed or deleted fixture. Tracked, reviewed-looking files that nothing
 * exercises any more are the missing-golden hole in the other direction.
 */
export function findStaleGoldens(dir: string, expected: readonly string[]): string[] {
  if (!existsSync(dir)) return [];
  const accounted = new Set(expected);
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json') && !accounted.has(name))
    .sort();
}

/** Deletes the stale goldens and returns their names. Regeneration only. */
export function pruneStaleGoldens(
  dir: string,
  expected: readonly string[],
  env: GoldenEnv = process.env,
): string[] {
  const stale = findStaleGoldens(dir, expected);
  if (stale.length === 0) return stale;
  refuseUnlessRegenerating(`delete ${stale.length} stale golden(s)`, env);
  for (const name of stale) rmSync(join(dir, name));
  return stale;
}
