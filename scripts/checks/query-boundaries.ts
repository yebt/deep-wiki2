/**
 * Structural check: single decision path, path sargability, secret-field
 * guards, and the AI provider boundaries (design.md — "Preventing the
 * non-sargable `text` path"; "Credentials that must never be logged,
 * serialised or rendered"; ai-provider-foundation design.md — "Extending
 * `query-boundaries.ts` so the guard is not vacuous").
 *
 * Seven rules, each independently testable against a fixture:
 *   1. No file outside `packages/db/src/permissions/` may reference the
 *      `permissions` table via a SQL verb (FROM/JOIN/INTO/UPDATE) — `can()`
 *      is the single decision point; a second read path for machines is
 *      the failure this design exists to prevent.
 *   2. No `path LIKE` predicate (or a `.like()` call) may appear outside
 *      `packages/db/src/nodes/subtree.ts`, the one module allowed to write
 *      a `path` prefix predicate.
 *   3. No pattern literal may start with a leading wildcard (`%foo`) — a
 *      leading wildcard defeats `text_pattern_ops` sargability. A bare
 *      `'%'` used to build a trailing-wildcard pattern (`prefix || '%'`)
 *      is not itself a leading-wildcard literal and is not flagged.
 *   4. No `lower(path)` / `upper(path)` call anywhere — a function-wrapped
 *      column is never sargable, and the path CHECK constraint already
 *      guarantees lowercase-only content, so this call could only ever be
 *      redundant or actively harmful.
 *   5. No zod schema exported under a `*Response*` name in
 *      `packages/contracts/src` or `apps/api/src/routes` may declare a
 *      denylisted secret-shaped field — exact AI-credential names, their
 *      camelCase forms, and suffix-anchored generics (`*ApiKey`,
 *      `*Secret`, `*Token`, `*Credential`). A `TOKEN_COUNT_ALLOWLIST`
 *      keeps the `*Token` suffix from flagging the usage schema's own
 *      legitimate `inputTokens`/`outputTokens`/`cachedInputTokens`/
 *      `reasoningTokens` counters (ai-provider-foundation design.md D17).
 *   6. No file outside `apps/api/src/ai/gateway/` may import `ai`,
 *      `@ai-sdk/*` or `@openrouter/*` — the one directory allowed to
 *      construct a provider client (D1).
 *   7. No file outside `apps/api/src/adapters/ai/credentials/` may import
 *      the cipher module — decryption happens in exactly one place.
 *
 * Rules 1 and 2 exclude `*.test.ts`/`*.spec.ts` files: verifying the
 * resolver's or the subtree query's real SQL behaviour (the truth table,
 * the EXPLAIN cost proof) legitimately embeds these exact patterns.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export interface QueryBoundariesResult {
  ok: boolean;
  errors: string[];
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.astro', '.output', 'coverage', '__fixtures__']);
const SOURCE_FILE_PATTERN = /\.ts$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.ts$/;

const PERMISSIONS_TABLE_PATTERN = /\b(FROM|JOIN|INTO|UPDATE)\s+permissions\b/i;
const PATH_LIKE_PATTERN = /\bpath\s+LIKE\b|\.like\(/i;
const LEADING_WILDCARD_PATTERN = /(['"`])%[^%'"`]+\1/;
const LOWER_UPPER_PATH_PATTERN = /\b(lower|upper)\s*\(\s*path\s*\)/i;

const DENYLISTED_FIELDS = [
  'password_hash',
  'token_hash',
  'session_token',
  'reset_token',
  'invitation_token',
  'SMTP_PASSWORD',
  'BLOB_STORE_S3_SECRET_ACCESS_KEY',
  'DATABASE_URL',
  // AI-credential exact snake_case columns (ai-provider-foundation
  // design.md — "Extending query-boundaries.ts"; 0008_ai_settings_and_credentials.sql).
  'ciphertext',
  'auth_tag',
  'wrapped_dek',
  'key_id',
  'dek',
  'kek',
  'key_material',
  // camelCase equivalents.
  'wrappedDek',
  'authTag',
  'keyMaterial',
  'apiKey',
  'apiKeyCiphertext',
  'keyId',
  // Envelope-encryption env variable names (environment-config delta).
  'AI_KEK_KEYRING',
  'AI_KEK_ACTIVE_ID',
  'AI_KEK_KMS_KEY_ID',
];

/**
 * Suffix-anchored generics (design.md — "Extending query-boundaries.ts").
 * Applied only to field names not already covered by `DENYLISTED_FIELDS`
 * or `TOKEN_COUNT_ALLOWLIST`.
 */
const SUFFIX_DENYLIST_PATTERNS = [/(_api_key|ApiKey)$/, /(_secret|Secret)$/, /(_token|Token)$/, /(_credential|Credential)$/];

/**
 * The named trap (D17): a bare `*Token` suffix rule would flag the usage
 * schema's own legitimate counters. Listed here, not silenced by
 * softening the rule — a suppressed guard is worse than no guard.
 */
const TOKEN_COUNT_ALLOWLIST = new Set(['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens']);

/** Matches `fieldName: z.…` — anchoring to a zod call keeps this from firing on an unrelated `cond ? a : b` ternary. */
const ZOD_FIELD_PATTERN = /(['"`]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*:\s*z\./g;

function isDenylistedFieldName(name: string): boolean {
  if (TOKEN_COUNT_ALLOWLIST.has(name)) return false;
  if (DENYLISTED_FIELDS.includes(name)) return true;
  return SUFFIX_DENYLIST_PATTERNS.some((pattern) => pattern.test(name));
}

/** `from '<specifier>'` / `export … from '<specifier>'`, used by rules 6 and 7. */
const IMPORT_SPECIFIER_PATTERN = /\bfrom\s+(['"])([^'"]+)\1/g;

function isDisallowedSdkSpecifier(specifier: string): boolean {
  return specifier === 'ai' || specifier.startsWith('@ai-sdk/') || specifier.startsWith('@openrouter/');
}

/**
 * This check's own source and test necessarily contain the exact text
 * patterns it searches for — in doc comments, regex literals, and
 * assertion strings describing the violating fixtures. Fixture-based
 * tests already exercise its real behaviour, so self-matches here would
 * be pure noise, not a finding.
 */
const SELF_FILES = new Set(['query-boundaries.ts', 'query-boundaries.test.ts']);

function isSelfFile(file: string): boolean {
  return SELF_FILES.has(file.split(sep).pop() ?? '');
}

function findFiles(dir: string, pattern: RegExp): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry)) {
        found.push(full);
      }
    }
  }

  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    walk(dir);
  }
  return found;
}

function isUnderPath(file: string, prefix: string): boolean {
  const rel = relative(prefix, file);
  return !rel.startsWith('..') && !rel.startsWith(`.${sep}..`);
}

function checkPermissionsSinglePath(root: string, errors: string[]): void {
  const permissionsDir = join(root, 'packages', 'db', 'src', 'permissions');
  const files = findFiles(root, SOURCE_FILE_PATTERN).filter(
    (f) => !TEST_FILE_PATTERN.test(f) && !isUnderPath(f, permissionsDir) && !isSelfFile(f),
  );

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (PERMISSIONS_TABLE_PATTERN.test(content)) {
      errors.push(
        `${relative(root, file)}: references the permissions table outside packages/db/src/permissions/ — ` +
          `can() must be the single decision point`,
      );
    }
  }
}

function checkPathLikeBoundary(root: string, errors: string[]): void {
  const subtreeFile = join(root, 'packages', 'db', 'src', 'nodes', 'subtree.ts');
  const files = findFiles(root, SOURCE_FILE_PATTERN).filter(
    (f) => !TEST_FILE_PATTERN.test(f) && f !== subtreeFile && !isSelfFile(f),
  );

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (PATH_LIKE_PATTERN.test(content)) {
      errors.push(
        `${relative(root, file)}: contains a path LIKE predicate outside packages/db/src/nodes/subtree.ts, ` +
          `the one module allowed to write a path prefix predicate`,
      );
    }
  }
}

function checkLeadingWildcard(root: string, errors: string[]): void {
  const files = findFiles(root, SOURCE_FILE_PATTERN).filter((f) => !isSelfFile(f));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (LEADING_WILDCARD_PATTERN.test(content)) {
      errors.push(`${relative(root, file)}: contains a pattern literal with a leading wildcard (%...), which defeats text_pattern_ops sargability`);
    }
  }
}

function checkLowerUpperPath(root: string, errors: string[]): void {
  const files = findFiles(root, SOURCE_FILE_PATTERN).filter((f) => !isSelfFile(f));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    if (LOWER_UPPER_PATH_PATTERN.test(content)) {
      errors.push(`${relative(root, file)}: contains lower(path) or upper(path) — a function-wrapped column is never sargable`);
    }
  }
}

/**
 * Scanned directories widened to `apps/api/src/routes` (ai-provider-foundation
 * design.md — "Extending query-boundaries.ts"): a hand-built JSON body in
 * a route handler can leak a credential field without ever touching a
 * schema in `packages/contracts`.
 */
function checkSecretFields(root: string, errors: string[]): void {
  const targetDirs = [join(root, 'packages', 'contracts', 'src'), join(root, 'apps', 'api', 'src', 'routes')];

  for (const dir of targetDirs) {
    const files = findFiles(dir, SOURCE_FILE_PATTERN).filter((f) => !TEST_FILE_PATTERN.test(f));

    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (!/Response/.test(content)) continue;

      for (const match of content.matchAll(ZOD_FIELD_PATTERN)) {
        const fieldName = match[2];
        if (fieldName && isDenylistedFieldName(fieldName)) {
          errors.push(`${relative(root, file)}: a response schema declares the denylisted field "${fieldName}"`);
        }
      }
    }
  }
}

/** Rule 6 (D1): no provider client can be constructed anywhere else. */
function checkSdkImportBoundary(root: string, errors: string[]): void {
  const gatewayDir = join(root, 'apps', 'api', 'src', 'ai', 'gateway');
  const apiSrcDir = join(root, 'apps', 'api', 'src');
  const files = findFiles(apiSrcDir, SOURCE_FILE_PATTERN).filter(
    (f) => !TEST_FILE_PATTERN.test(f) && !isUnderPath(f, gatewayDir) && !isSelfFile(f),
  );

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[2];
      if (specifier && isDisallowedSdkSpecifier(specifier)) {
        errors.push(
          `${relative(root, file)}: imports "${specifier}" outside apps/api/src/ai/gateway/, the one directory ` +
            `allowed to construct a provider client`,
        );
      }
    }
  }
}

/** Rule 7: only the credentials adapter may reach the cipher's `open`. */
function checkDecryptionBoundary(root: string, errors: string[]): void {
  const credentialsDir = join(root, 'apps', 'api', 'src', 'adapters', 'ai', 'credentials');
  const cipherDir = join(root, 'apps', 'api', 'src', 'adapters', 'ai', 'cipher');
  const apiSrcDir = join(root, 'apps', 'api', 'src');
  const files = findFiles(apiSrcDir, SOURCE_FILE_PATTERN).filter(
    (f) => !TEST_FILE_PATTERN.test(f) && !isUnderPath(f, credentialsDir) && !isUnderPath(f, cipherDir) && !isSelfFile(f),
  );

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const match of content.matchAll(IMPORT_SPECIFIER_PATTERN)) {
      const specifier = match[2];
      if (!specifier || !specifier.startsWith('.')) continue;

      const resolved = resolve(dirname(file), specifier);
      if (resolved === cipherDir || isUnderPath(resolved, cipherDir)) {
        errors.push(
          `${relative(root, file)}: imports from the cipher module (${specifier}) outside ` +
            `apps/api/src/adapters/ai/credentials/, the one directory allowed to decrypt a credential`,
        );
      }
    }
  }
}

export function checkQueryBoundaries(root: string): QueryBoundariesResult {
  const errors: string[] = [];

  checkPermissionsSinglePath(root, errors);
  checkPathLikeBoundary(root, errors);
  checkLeadingWildcard(root, errors);
  checkLowerUpperPath(root, errors);
  checkSecretFields(root, errors);
  checkSdkImportBoundary(root, errors);
  checkDecryptionBoundary(root, errors);

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const target = process.argv[2] ?? process.cwd();
  const result = checkQueryBoundaries(target);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`query-boundaries: ${err}`);
    }
    process.exit(1);
  }
  console.log('query-boundaries: ok');
}
