/**
 * The e2e suite must be reachable from a committed command.
 *
 * It was not. There was no `e2e` script in the root `package.json`, and
 * `verify` did not run Playwright. The only caller was
 * `.github/workflows/ci.yml`'s `e2e` job — and this repository has no git
 * remote, so that workflow has never run and cannot run. Enforcement here
 * is local and always has been. The consequence was that the only evidence
 * for three behaviours nothing else can prove sat in dead code:
 *
 *   - "Live Preview Renders In Place"        e2e/editor.spec.ts
 *   - read mode fetches no ProseMirror       e2e/read.spec.ts (asserts
 *     bundle at runtime                      zero prosemirror/milkdown/
 *                                            tiptap network requests)
 *   - lock take-over / read-only surface     e2e/editor.spec.ts
 *
 * A workflow-shape assertion is the same mechanism `gate-2-ci-gate.test.ts`
 * already uses for GATE-2, applied to the thing that actually decides
 * whether these tests run: the root manifest.
 *
 * The three assertions are: a root `e2e` script exists; `verify` invokes
 * it; and every `*.spec.ts` in `e2e/` is inside the directory
 * `playwright.config.ts` collects from, so adding a spec file is enough to
 * have it run.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkBrowser } from '../../e2e';

const ROOT = join(import.meta.dir, '..', '..', '..');

interface RootManifest {
  scripts: Record<string, string>;
}

function manifest(): RootManifest {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as RootManifest;
}

describe('the e2e suite is reachable from a committed command', () => {
  test('the root package.json declares an e2e script', () => {
    const { scripts } = manifest();

    expect(scripts.e2e).toBeDefined();
    expect(scripts.e2e).toContain('scripts/e2e.ts');
  });

  test('verify runs it, so tagging a milestone actually exercises Playwright', () => {
    const { scripts } = manifest();

    // `verify` is the milestone gate and is deliberately not in
    // `.githooks/pre-commit` (CLAUDE.md), which is the only reason a suite
    // needing a database, two servers and a browser can live in it at all.
    expect(scripts.verify).toContain('bun run e2e');
  });

  test('e2e runs after the cheap gates, so a lint error never costs a browser run', () => {
    const { scripts } = manifest();
    const verify = scripts.verify!;

    expect(verify.indexOf('bun run e2e')).toBeGreaterThan(verify.indexOf('bun run lint'));
    expect(verify.indexOf('bun run e2e')).toBeGreaterThan(verify.indexOf('bun run test'));
  });

  test('an install escape hatch exists for the one prerequisite that cannot self-provision', () => {
    const { scripts } = manifest();

    // Everything else the suite needs provisions itself (e2e/global-setup.ts
    // -> e2e/seed.bun.ts -> packages/db/testing/provision.ts, and
    // playwright.config.ts's webServer). The browser binary does not.
    expect(scripts['e2e:install']).toContain('playwright install');
  });

  test('every spec in e2e/ sits inside the directory playwright.config.ts collects', () => {
    const config = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8');
    const testDir = /testDir:\s*['"]([^'"]+)['"]/.exec(config)?.[1];

    expect(testDir).toBe('./e2e');

    const specs = readdirSync(join(ROOT, 'e2e')).filter((f) => f.endsWith('.spec.ts'));
    expect(specs.length).toBeGreaterThan(0);
    // Named explicitly: these are the files whose absence from any
    // committed command was the defect.
    expect(specs).toContain('editor.spec.ts');
    expect(specs).toContain('read.spec.ts');
  });
});

describe('the browser preflight fails loudly instead of downloading', () => {
  test('a missing browser names the exact command to run', () => {
    const result = checkBrowser('/nowhere/chrome', () => false);

    expect(result.ok).toBe(false);
    expect(result.message).toContain('bun run e2e:install');
    expect(result.message).toContain('/nowhere/chrome');
  });

  test('an installed browser passes silently', () => {
    expect(checkBrowser('/somewhere/chrome', () => true)).toEqual({ ok: true });
  });
});
