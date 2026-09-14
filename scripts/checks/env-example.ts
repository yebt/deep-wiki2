/**
 * Structural check: the environment template lists every variable the
 * zod server-env schema (packages/contracts/src/env.ts) declares, so the
 * template cannot silently drift from what the app actually reads.
 *
 * A second, cheaper rule (versioning-and-collaboration design.md Decision
 * 4) closes the residual gap the presence check leaves open: for every
 * schema key that carries a zod `.default()`, if `env.example` also
 * assigns that key a value, the two MUST parse equal. Before this rule,
 * nothing compared them — `PAGE_LOCK_TTL_SECONDS=120` happened to agree
 * with `.default(120)` with no mechanism enforcing it at all.
 *
 * ---------------------------------------------------------------------------
 * A third rule, and the design decision behind it: "must never contain a
 * secret" (CLAUDE.md) used to have NO mechanism whatsoever. Nothing here told
 * the intended placeholder `POSTGRES_PASSWORD=deepwiki` apart from a pasted
 * production credential.
 *
 * WHAT WAS CHOSEN, AND WHY. A required-placeholder convention, not a secret
 * detector. Entropy thresholds and prefix denylists both answer "does this
 * look like a secret?", a question with no reliable answer: a real password
 * can be low-entropy and match no known vendor prefix. The convention inverts
 * it into a question a check can actually decide — "is this one of the few
 * values we have agreed a template is allowed to hold?" — so the burden of
 * proof sits with the value, not with the detector. Concretely:
 *
 *   3a. A key whose NAME ends in a secret word (PASSWORD, SECRET, TOKEN, KEY,
 *       CREDENTIAL, PASSPHRASE, SALT — see `isSecretShapedKey`) must hold
 *       either nothing at all or an obvious placeholder: an all-lowercase `word[-word]*` value whose
 *       first word comes from PLACEHOLDER_ROOTS. That is what the real
 *       env.example already does (`deepwiki`, `deepwiki-minio`, and empty),
 *       so the convention was fitted to the file rather than the reverse.
 *   3b. The same rule applies to a password embedded in a URL value
 *       (`postgres://user:PASSWORD@host`), whose key name — DATABASE_URL —
 *       gives nothing away.
 *   3c. A second, open-ended net over EVERY value: shapes that are
 *       unmistakably a real credential (`sk-…`, `ghp_…`, `AKIA…`, `xox…`,
 *       a PEM private key, a three-segment JWT). This catches the common
 *       paste under a key name rule 3a cannot see.
 *
 * WHAT THIS CANNOT SEE — the honest part, because a check that oversells
 * itself is worse than none:
 *
 *   - Rule 3a is a convention, not detection. If the production password
 *     genuinely IS `deepwiki`, this check passes it, by construction. It
 *     enforces that the template holds an agreed placeholder; it cannot know
 *     whether that placeholder is also live somewhere.
 *   - Rule 3a only looks at keys whose LAST segment is a secret word. A secret
 *     parked under `FOO=…`, or under a name like `SECRET_KEY_BASE` where the
 *     secret word is not last, is invisible to it — only rule 3c's fixed shapes might
 *     catch that, and rule 3c is a denylist: it sees the vendor formats
 *     listed and nothing else. A bare 32-character password under a
 *     neutral key name passes.
 *   - Comment lines are not scanned at all (`parseTemplateValues` skips
 *     them), so a credential in a `#` comment passes.
 *   - Structured values — JSON blobs, DSNs that are not `scheme://user:pass@`
 *     — are only scanned by rule 3c's shapes, not decomposed.
 *
 * The residue is human review. What this rule buys is that the residue is
 * now the exception rather than the whole surface.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { envSchema } from '../../packages/contracts/src/env';

export interface EnvExampleResult {
  ok: boolean;
  errors: string[];
}

const KEY_LINE_PATTERN = /^([A-Z][A-Z0-9_]*)=(.*)$/;

export function parseTemplateKeys(content: string): Set<string> {
  return new Set(parseTemplateValues(content).keys());
}

/** Maps every declared key in the template to its raw, unparsed assigned value (may be empty). */
export function parseTemplateValues(content: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = KEY_LINE_PATTERN.exec(line);
    if (match?.[1] !== undefined) values.set(match[1], match[2] ?? '');
  }

  return values;
}

/**
 * For every key in `schema` that carries a `.default()`, and that
 * `templateValues` also assigns a value to, parses both through the exact
 * same zod field (so `z.coerce.number()` etc. coerce identically) and
 * requires them to be deep-equal. A key the template never assigns is not
 * this rule's concern — that is the presence check above.
 */
export function checkDefaultsAgreement(
  templateValues: ReadonlyMap<string, string>,
  schema: z.ZodObject<z.ZodRawShape>,
): string[] {
  const errors: string[] = [];

  for (const [key, fieldSchema] of Object.entries(schema.shape)) {
    if (!(fieldSchema instanceof z.ZodDefault)) continue;

    const rawValue = templateValues.get(key);
    if (rawValue === undefined) continue;

    const schemaDefault: unknown = fieldSchema.parse(undefined);

    let templateValue: unknown;
    try {
      templateValue = fieldSchema.parse(rawValue);
    } catch {
      errors.push(
        `${key}: env.example's value "${rawValue}" does not satisfy the schema that declares its default (${JSON.stringify(schemaDefault)})`,
      );
      continue;
    }

    if (!Object.is(schemaDefault, templateValue) && JSON.stringify(schemaDefault) !== JSON.stringify(templateValue)) {
      errors.push(
        `${key}: schema default (${JSON.stringify(schemaDefault)}) disagrees with env.example's assigned value (${JSON.stringify(templateValue)})`,
      );
    }
  }

  return errors;
}

const SECRET_WORDS = new Set([
  'PASSWORD',
  'PASSWD',
  'SECRET',
  'TOKEN',
  'KEY',
  'CREDENTIAL',
  'CREDENTIALS',
  'PASSPHRASE',
  'SALT',
]);

/**
 * A key name that announces its value IS a credential — as opposed to one
 * that merely mentions credentials. The secret word has to be the key's last
 * segment: `POSTGRES_PASSWORD` holds a password, `PASSWORD_RESET_TTL_MINUTES`
 * holds the number 30, and a rule that matched the word anywhere failed the
 * real env.example on exactly that line. `…_KEY_ID` is the one exception
 * worth naming, because an access key id travels with its secret.
 *
 * Consequence, stated plainly: `SECRET_KEY_BASE` or `PASSWORD_FOR_DB` are NOT
 * secret-shaped under this rule. They are covered only by rules 3b/3c, which
 * look at values and ignore key names entirely.
 */
export function isSecretShapedKey(key: string): boolean {
  const segments = key.split('_');
  const last = segments[segments.length - 1] ?? '';
  if (SECRET_WORDS.has(last)) return true;

  const secondLast = segments[segments.length - 2] ?? '';
  return last === 'ID' && SECRET_WORDS.has(secondLast);
}

/**
 * The vocabulary a placeholder is allowed to start with. Deliberately tiny:
 * every addition widens the hole in rule 3a, so a value only earns a place
 * here when it is unmistakably a stand-in.
 */
const PLACEHOLDER_ROOTS = new Set([
  'deepwiki',
  'changeme',
  'change',
  'placeholder',
  'example',
  'dummy',
  'password',
  'pass',
  'secret',
  'test',
  'local',
  'none',
  'todo',
]);

/** `word`, or `word-word`/`word_word` — lowercase letters and digits only. */
const PLACEHOLDER_SHAPE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

/** `scheme://user:password@host…` — the one composite shape worth decomposing. */
const URL_WITH_CREDENTIALS = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#@\s]*):([^/?#@\s]*)@/;

/**
 * Shapes that are a credential and cannot plausibly be anything else. This
 * list is a denylist and therefore never complete — it is the second net
 * under rule 3a, not a replacement for it.
 */
const KNOWN_CREDENTIAL_SHAPES: ReadonlyArray<{ what: string; pattern: RegExp }> = [
  { what: 'an OpenAI-style API key (sk-…)', pattern: /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{16,}/ },
  { what: 'a GitHub token', pattern: /(?:^|[^A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { what: 'an AWS access key id', pattern: /(?:^|[^A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![0-9A-Za-z])/ },
  { what: 'a Slack token', pattern: /(?:^|[^A-Za-z0-9])xox[abposr]-[A-Za-z0-9-]{10,}/ },
  { what: 'a PEM private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { what: 'a JSON Web Token', pattern: /(?:^|[^A-Za-z0-9])eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
];

function unquote(value: string): string {
  const trimmed = value.trim();
  const quoted = /^(['"])(.*)\1$/.exec(trimmed);
  return quoted?.[2] ?? trimmed;
}

/**
 * True for a value a committed template is allowed to hold in a secret's
 * place: nothing at all, or an obvious placeholder.
 */
export function isObviousPlaceholder(rawValue: string): boolean {
  const value = unquote(rawValue);
  if (value === '') return true;
  if (!PLACEHOLDER_SHAPE.test(value)) return false;

  const firstWord = value.split(/[-_]/)[0] ?? '';
  return PLACEHOLDER_ROOTS.has(firstWord);
}

/**
 * Rules 3a/3b/3c. Pure over the parsed template, so it can be tested against
 * the real `env.example` as well as against fixtures.
 */
export function checkTemplateSecrets(templateValues: ReadonlyMap<string, string>): string[] {
  const errors: string[] = [];
  const placeholders = [...PLACEHOLDER_ROOTS].join(', ');

  for (const [key, rawValue] of templateValues) {
    const value = unquote(rawValue);

    for (const { what, pattern } of KNOWN_CREDENTIAL_SHAPES) {
      if (pattern.test(value)) {
        errors.push(
          `${key}: this value is shaped like ${what}. env.example is committed and must never contain a secret`,
        );
        break;
      }
    }

    if (isSecretShapedKey(key) && !isObviousPlaceholder(value)) {
      errors.push(
        `${key}: a secret-shaped key must be empty or hold an obvious placeholder ` +
          `(one of: ${placeholders}, optionally suffixed like "deepwiki-minio"), not ${JSON.stringify(value)} — ` +
          'env.example is committed and must never contain a secret; put your real value in .env',
      );
      continue;
    }

    const url = URL_WITH_CREDENTIALS.exec(value);
    const urlPassword = url?.[2];
    if (urlPassword !== undefined && !isObviousPlaceholder(urlPassword)) {
      errors.push(
        `${key}: the password embedded in this URL (${JSON.stringify(urlPassword)}) is not an obvious placeholder ` +
          `(one of: ${placeholders}) — env.example is committed and must never contain a secret`,
      );
    }
  }

  return errors;
}

export function checkEnvExample(
  templatePath: string,
  requiredKeys: readonly string[],
  schema?: z.ZodObject<z.ZodRawShape>,
): EnvExampleResult {
  if (!existsSync(templatePath)) {
    return { ok: false, errors: [`${templatePath} does not exist`] };
  }

  const templateValues = parseTemplateValues(readFileSync(templatePath, 'utf8'));
  const present = new Set(templateValues.keys());
  const missing = requiredKeys.filter((key) => !present.has(key));

  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`Environment template is missing variable(s) declared by the schema: ${missing.join(', ')}`);
  }

  errors.push(...checkTemplateSecrets(templateValues));

  if (schema) {
    errors.push(...checkDefaultsAgreement(templateValues, schema));
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true, errors: [] };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const templatePath = join(root, 'env.example');
  const requiredKeys = Object.keys(envSchema.shape);
  const result = checkEnvExample(templatePath, requiredKeys, envSchema);

  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`env-example: ${err}`);
    }
    process.exit(1);
  }
  console.log('env-example: ok');
}
