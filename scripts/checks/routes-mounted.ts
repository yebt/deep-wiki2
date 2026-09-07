/**
 * Structural check: every route module is actually reachable.
 *
 * This defect has now shipped twice. In Phase 1, `admin`, `invitations` and
 * `uploads` were fully implemented and unit-tested while `apps/api`'s
 * composition root wired only `createAuthRoutes` — every test passed and no
 * browser could reach any of them. In Phase 5 the same thing happened to
 * `ai-credentials`.
 *
 * Unit tests cannot catch it: they invoke the route factory directly and
 * never go through the running server. Neither can typecheck, because an
 * unmounted module is still a valid module. The only signal is a request
 * that never arrives, which surfaces days later as "the API is down".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface RoutesMountedResult {
  ok: boolean;
  errors: string[];
}

/** `createFooRoutes` / `createFooRoute` exported from a route module. */
const FACTORY = /export\s+(?:async\s+)?function\s+(create[A-Za-z0-9_]*Routes?)\s*\(/g;

export function factoriesIn(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(FACTORY)) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

export function checkMounted(
  routeModules: ReadonlyMap<string, string>,
  compositionRoot: string,
): RoutesMountedResult {
  const errors: string[] = [];

  for (const [file, source] of routeModules) {
    for (const factory of factoriesIn(source)) {
      // A bare mention is enough: the point is to catch a module nobody
      // references at all, not to police how it is wired.
      if (!compositionRoot.includes(factory)) {
        errors.push(
          `${file} exports ${factory}() but apps/api/src/index.ts never references it. ` +
            `The routes are unreachable from a running server, and unit tests cannot see that ` +
            `because they call the factory directly.`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const routesDir = join(root, 'apps/api/src/routes');
  const rootFile = join(root, 'apps/api/src/index.ts');

  const modules = new Map<string, string>();
  for (const entry of readdirSync(routesDir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    modules.set(`apps/api/src/routes/${entry}`, readFileSync(join(routesDir, entry), 'utf8'));
  }

  const result = checkMounted(modules, readFileSync(rootFile, 'utf8'));
  if (!result.ok) {
    for (const err of result.errors) console.error(`routes-mounted: ${err}`);
    process.exit(1);
  }
  console.log('routes-mounted: ok');
}
