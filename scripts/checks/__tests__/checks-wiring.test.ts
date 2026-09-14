/**
 * Every structural check must be reachable from a committed, locally
 * runnable command.
 *
 * Two of them were not. `compose-smoke.ts` and `bundle-isolation-build.ts`
 * had exactly one caller between them — `.github/workflows/ci.yml` — and
 * this repository has no git remote, so that workflow has never run and
 * cannot run. Expanding the root scripts, `verify` was `check` +
 * `env-consistency` + `lint` + `typecheck` + `test` + the GATE-2 round trip
 * + `e2e`, and neither check appeared anywhere in it.
 *
 * The consequence was not theoretical. `bundle-isolation-build.ts` is
 * layer 3 of "read mode never reaches the ProseMirror bundle" — the only
 * layer that inspects a real build's chunk graph — and it had never
 * executed against a real build in its life. When it was finally run by
 * hand it exited 1 against a `.output` five days stale, and nobody had
 * noticed, because nothing ran it.
 *
 * This is the same defect `e2e-wiring.test.ts` was written to close for
 * `e2e/`, left unclosed for the checks themselves. The mechanism is the
 * same one, pointed at `scripts/checks/`: enumerate the directory with
 * `readdirSync` rather than listing names by hand, so a check added
 * tomorrow is covered by a test written today. A hand-maintained list would
 * reproduce the original defect — the unreachable check is precisely the
 * one nobody remembers to add to the list.
 *
 * ── The contract ───────────────────────────────────────────────────────
 *
 * For every `scripts/checks/*.ts` that is a check (not a test, not a
 * fixture):
 *
 *   W1  a root `package.json` script names its path;
 *   W2  it is transitively reachable from `verify` — the one gate CLAUDE.md
 *       says to run before tagging a milestone — UNLESS it is listed in
 *       `PREREQUISITE_GATES` below, which is the written-down justification
 *       for why it cannot be, and names the command that does run it;
 *   W3  it has an executing test of its own.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const CHECKS_DIR = join(ROOT, 'scripts', 'checks');

/**
 * The one legitimate reason a check cannot sit inside `verify`: it needs a
 * prerequisite `verify` does not and should not provision. Each entry has
 * to name the prerequisite and the committed command that runs the check,
 * so "it is not in verify" is always a recorded decision rather than an
 * omission nobody noticed.
 */
const PREREQUISITE_GATES: Readonly<Record<string, { readonly script: string; readonly prerequisite: string }>> = {
  'compose-smoke.ts': {
    script: 'compose:smoke',
    prerequisite:
      'a running container stack (`podman compose up -d --wait`). It asserts against live Mailpit ' +
      'and Kroki endpoints, so it cannot run in a gate that starts no containers — compose-smoke.ts ' +
      'says so in its own header.',
  },
};

interface RootManifest {
  readonly scripts: Record<string, string>;
}

function manifest(): RootManifest {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as RootManifest;
}

/** Every check script in `scripts/checks/`, read from the directory rather than listed by hand. */
export function checkScripts(): string[] {
  return readdirSync(CHECKS_DIR)
    .filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
    .sort();
}

/**
 * A root script's command with every `bun run <other-script>` reference
 * replaced by that script's own command, transitively. `verify` delegates
 * almost everything, so its literal text names one check and its expansion
 * names all of them.
 */
export function expandScript(scripts: Record<string, string>, name: string, seen = new Set<string>()): string {
  if (seen.has(name)) return '';
  seen.add(name);

  const command = scripts[name];
  if (command === undefined) return '';

  return command.replace(/bun run (?:--filter '\*' )?([A-Za-z0-9:_-]+)/g, (match, referenced: string) =>
    Object.prototype.hasOwnProperty.call(scripts, referenced)
      ? `${match} ( ${expandScript(scripts, referenced, seen)} )`
      : match,
  );
}

describe('every structural check is reachable from a committed command', () => {
  const { scripts } = manifest();
  const allScriptText = Object.values(scripts).join('\n');
  const verify = expandScript(scripts, 'verify');
  const checks = checkScripts();

  test('the enumeration itself found the checks (a readdir that finds nothing proves nothing)', () => {
    expect(checks.length).toBeGreaterThanOrEqual(10);
    expect(checks).toContain('core-purity.ts');
    expect(checks).toContain('bundle-isolation-build.ts');
    expect(checks).toContain('compose-smoke.ts');
  });

  test.each(checks)('W1: a root script names scripts/checks/%s', (check) => {
    expect(allScriptText).toContain(`scripts/checks/${check}`);
  });

  test.each(checks)('W2: verify reaches scripts/checks/%s, or PREREQUISITE_GATES says why not', (check) => {
    const exemption = PREREQUISITE_GATES[check];

    if (exemption) {
      // The exemption has to be paid for: a real committed script that runs
      // it, and a written prerequisite. An empty entry is not a reason.
      expect(scripts[exemption.script]).toContain(`scripts/checks/${check}`);
      expect(exemption.prerequisite.length).toBeGreaterThan(40);
      return;
    }

    expect(verify).toContain(`scripts/checks/${check}`);
  });

  test.each(checks)('W3: scripts/checks/%s has an executing test', (check) => {
    const base = check.replace(/\.ts$/, '');
    const candidates = [
      join(CHECKS_DIR, '__tests__', `${base}.test.ts`),
      join(CHECKS_DIR, `${base}.test.ts`),
    ];
    const testFile = candidates.find((candidate) => existsSync(candidate));

    expect(testFile).toBeDefined();
    expect(readFileSync(testFile!, 'utf8')).toContain('expect(');
  });
});

describe('the build-output layer runs against a build, not against whatever is lying around', () => {
  // bundle-isolation-build.ts skips — deliberately, and reporting ok — when
  // there is no `.output`. That is right for a direct invocation and wrong
  // for a gate: a gate that skips is a gate that does not exist. The script
  // that runs it must build first, so "skipped" is never the gate's answer.
  test('check:bundle builds apps/web before inspecting its chunk graph', () => {
    const command = manifest().scripts['check:bundle'] ?? '';

    expect(command).toContain('-F @deep-wiki/web build');
    expect(command).toContain('scripts/checks/bundle-isolation-build.ts');
    expect(command.indexOf('build')).toBeLessThan(command.indexOf('bundle-isolation-build.ts'));
  });
});
