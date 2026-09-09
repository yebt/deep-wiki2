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
