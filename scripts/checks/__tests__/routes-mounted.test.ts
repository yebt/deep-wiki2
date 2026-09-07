import { describe, expect, test } from 'bun:test';
import { checkMounted, factoriesIn } from '../routes-mounted';

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
