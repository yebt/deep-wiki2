import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkMounted, collectRouteModules, factoriesIn } from '../routes-mounted';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'routes-mounted');

describe('factoriesIn', () => {
  test('finds an exported route factory', () => {
    expect(factoriesIn('export function createAuthRoutes(deps: D) {')).toEqual(['createAuthRoutes']);
  });

  test('finds an async one and the singular spelling', () => {
    expect(factoriesIn('export async function createUploadRoute(d: D) {')).toEqual(['createUploadRoute']);
  });

  test('ignores a helper that is not exported', () => {
    expect(factoriesIn('function createInternalRoutes() {')).toEqual([]);
  });
});

describe('checkMounted', () => {
  // Phase 1 shipped admin, invitations and uploads unreachable; Phase 5 shipped
  // ai-credentials the same way. Both had passing unit tests throughout.
  test('a factory the composition root never mentions fails', () => {
    const result = checkMounted(
      new Map([['apps/api/src/routes/ai-credentials.ts', 'export function createAiCredentialRoutes(d: D) {']]),
      "app.route('/', createAuthRoutes({}));",
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('createAiCredentialRoutes');
    expect(result.errors[0]).toContain('unreachable');
  });

  test('a mounted factory passes', () => {
    const result = checkMounted(
      new Map([['apps/api/src/routes/auth.ts', 'export function createAuthRoutes(d: D) {']]),
      "import { createAuthRoutes } from './routes/auth';\napp.route('/', createAuthRoutes({}));",
    );
    expect(result.ok).toBe(true);
  });

  test('every unmounted factory is reported, not just the first', () => {
    const result = checkMounted(
      new Map([
        ['a.ts', 'export function createARoutes(d: D) {'],
        ['b.ts', 'export function createBRoutes(d: D) {'],
      ]),
      'nothing here',
    );
    expect(result.errors).toHaveLength(2);
  });

  test('a module exporting no factory is not a finding', () => {
    expect(checkMounted(new Map([['x.ts', 'export const helper = 1;']]), '').ok).toBe(true);
  });
});

// Hole 3: an arrow-function factory is a factory. `export const
// createXRoutes = (deps) => …` is the same public surface as `export
// function`, and a check that only knows one spelling silently exempts the
// other.
describe('factoriesIn — non-`function` factory bindings', () => {
  test('finds an arrow-function factory declared with export const', () => {
    expect(factoriesIn('export const createAdminRoutes = (deps: D) => new Hono();')).toEqual([
      'createAdminRoutes',
    ]);
  });

  test('finds a type-annotated export const factory', () => {
    expect(factoriesIn('export const createTagRoutes: RouteFactory = (deps: D) => new Hono();')).toEqual([
      'createTagRoutes',
    ]);
  });

  test('finds export let and export var factory bindings', () => {
    expect(factoriesIn('export let createLetRoutes = (d: D) => 1;\nexport var createVarRoute = (d: D) => 2;')).toEqual([
      'createLetRoutes',
      'createVarRoute',
    ]);
  });

  test('still ignores a non-exported const factory', () => {
    expect(factoriesIn('const createInternalRoutes = (d: D) => 1;')).toEqual([]);
  });
});

// Hole 1: "a bare mention is enough" made the check satisfiable by prose.
// A `// TODO: mount createAdminRoutes` comment is precisely the artefact a
// developer leaves *because* the module is not mounted yet — the check
// must not read its own excuse as compliance.
describe('checkMounted — a mention is not a mount', () => {
  const routeModule = new Map([['apps/api/src/routes/admin.ts', 'export function createAdminRoutes(d: D) {']]);

  test('a factory named only inside a line comment is not mounted', () => {
    const result = checkMounted(
      routeModule,
      "// TODO: mount createAdminRoutes\napp.route('/', createAuthRoutes({}));",
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('createAdminRoutes');
  });

  test('a factory named only inside a block comment is not mounted', () => {
    const result = checkMounted(
      routeModule,
      "/**\n * createAdminRoutes is wired up in a follow-up.\n */\napp.route('/', createAuthRoutes({}));",
    );
    expect(result.ok).toBe(false);
  });

  test('a factory named only inside a string literal is not mounted', () => {
    const result = checkMounted(routeModule, "logger.warn('createAdminRoutes is still unmounted');");
    expect(result.ok).toBe(false);
  });

  test('a factory named only inside a template literal is not mounted', () => {
    const result = checkMounted(routeModule, 'logger.warn(`createAdminRoutes is still unmounted`);');
    expect(result.ok).toBe(false);
  });

  test('a real reference inside a template substitution still counts as mounted', () => {
    const result = checkMounted(routeModule, 'app.route(`/${prefix}`, createAdminRoutes({}));');
    expect(result.ok).toBe(true);
  });

  test('a factory whose name is only a prefix of a referenced identifier is not mounted', () => {
    const result = checkMounted(routeModule, 'app.route("/", createAdminRoutesLegacy({}));');
    expect(result.ok).toBe(false);
  });

  test('an ordinary import + mount still passes', () => {
    const result = checkMounted(
      routeModule,
      "import { createAdminRoutes } from './routes/admin';\napp.route('/admin', createAdminRoutes(deps));",
    );
    expect(result.ok).toBe(true);
  });
});

// Hole 2: the CLI read `apps/api/src/routes` non-recursively, so an entire
// nested route directory (`routes/admin/users.ts`) was never opened — the
// check reported ok on modules it had not read at all.
describe('collectRouteModules', () => {
  const routesDir = join(FIXTURES_DIR, 'nested-routes', 'apps', 'api', 'src', 'routes');

  test('collects modules from nested directories, not just the top level', () => {
    const modules = collectRouteModules(routesDir);

    expect([...modules.keys()].sort()).toEqual([
      'apps/api/src/routes/admin/deep/audit.ts',
      'apps/api/src/routes/admin/users.ts',
      'apps/api/src/routes/auth.ts',
    ]);
  });

  test('the nested modules carry their real source, so their factories are found', () => {
    const modules = collectRouteModules(routesDir);
    const result = checkMounted(modules, "app.route('/', createAuthRoutes({}));");

    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => e.split(' ')[0]).sort()).toEqual([
      'apps/api/src/routes/admin/deep/audit.ts',
      'apps/api/src/routes/admin/users.ts',
    ]);
  });
});
