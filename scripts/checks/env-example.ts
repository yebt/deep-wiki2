/**
 * Structural check: the environment template lists every variable the
 * zod server-env schema (packages/contracts/src/env.ts) declares, so the
 * template cannot silently drift from what the app actually reads.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { envSchema } from '../../packages/contracts/src/env';

export interface EnvExampleResult {
  ok: boolean;
  errors: string[];
}

const KEY_LINE_PATTERN = /^([A-Z][A-Z0-9_]*)=/;

export function parseTemplateKeys(content: string): Set<string> {
  const keys = new Set<string>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = KEY_LINE_PATTERN.exec(line);
    if (match?.[1]) keys.add(match[1]);
  }

  return keys;
}

export function checkEnvExample(templatePath: string, requiredKeys: readonly string[]): EnvExampleResult {
  if (!existsSync(templatePath)) {
    return { ok: false, errors: [`${templatePath} does not exist`] };
  }

  const present = parseTemplateKeys(readFileSync(templatePath, 'utf8'));
  const missing = requiredKeys.filter((key) => !present.has(key));

  if (missing.length > 0) {
    return {
      ok: false,
      errors: [`Environment template is missing variable(s) declared by the schema: ${missing.join(', ')}`],
    };
  }

  return { ok: true, errors: [] };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const templatePath = join(root, '.env.example');
  const requiredKeys = Object.keys(envSchema.shape);
  const result = checkEnvExample(templatePath, requiredKeys);

  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`env-example: ${err}`);
    }
    process.exit(1);
  }
  console.log('env-example: ok');
}
