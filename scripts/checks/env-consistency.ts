/**
 * Structural check: the ports an app connects to must agree with the ports
 * the compose stack publishes.
 *
 * `.env` carries both sides of the same fact — `POSTGRES_HOST_PORT` tells
 * compose where to publish, `DATABASE_URL` tells the app where to connect —
 * and nothing tied them together. Moving one without the other produced a
 * connection to whatever unrelated service happened to own the old port,
 * and the resulting error came from that other server, so it named a
 * database and a role the developer had never heard of.
 *
 * The same trap exists between `MAILPIT_SMTP_HOST_PORT` and `SMTP_PORT`, and
 * between `PORT` — where apps/api listens — and `NUXT_PUBLIC_API_BASE_URL`,
 * where the browser is told to find it.
 *
 * `APP_URL` is deliberately NOT compared against `PORT`. It is the browser's
 * origin for apps/web — the CORS allowlist entry and the host of the
 * `/reset-password` and `/invite/accept` links mailed to users. Tying it to
 * the API's port is the mistake this comment exists to prevent.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EnvConsistencyResult {
  ok: boolean;
  errors: string[];
}

const LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;

export function parseEnv(content: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (m?.[1] !== undefined) out.set(m[1], (m[2] ?? '').trim());
  }
  return out;
}

export function portOfUrl(url: string): string | undefined {
  try {
    // postgres:// is not a special scheme, so URL keeps the port verbatim.
    const parsed = new URL(url);
    return parsed.port || undefined;
  } catch {
    return undefined;
  }
}

/** Pairs of (published host port var, the var that must agree with it, how it is expressed). */
const PAIRS: readonly { publish: string; consume: string; kind: 'url' | 'port'; hint: string }[] = [
  { publish: 'POSTGRES_HOST_PORT', consume: 'DATABASE_URL', kind: 'url', hint: 'the port inside DATABASE_URL' },
  { publish: 'MAILPIT_SMTP_HOST_PORT', consume: 'SMTP_PORT', kind: 'port', hint: 'SMTP_PORT' },
  { publish: 'PORT', consume: 'NUXT_PUBLIC_API_BASE_URL', kind: 'url', hint: "the port inside NUXT_PUBLIC_API_BASE_URL" },
];

export function checkEnvConsistency(env: Map<string, string>): EnvConsistencyResult {
  const errors: string[] = [];

  for (const pair of PAIRS) {
    const published = env.get(pair.publish);
    const consumed = env.get(pair.consume);
    if (!published || !consumed) continue;

    const actual = pair.kind === 'url' ? portOfUrl(consumed) : consumed;
    if (!actual) continue;

    if (actual !== published) {
      errors.push(
        `${pair.publish}=${published} but ${pair.hint} is ${actual}. ` +
          `One says ${published}, the other says ${actual}. They are the same fact written twice — ` +
          `one says where the service listens or is published, the other says where to reach it. ` +
          `On a busy machine the mismatched one lands on another project's service. Set them equal.`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const envPath = join(root, '.env');

  if (!existsSync(envPath)) {
    // A fresh clone has no .env yet; that is env-example.ts's business.
    console.log('env-consistency: ok (no .env)');
    process.exit(0);
  }

  const result = checkEnvConsistency(parseEnv(readFileSync(envPath, 'utf8')));
  if (!result.ok) {
    for (const err of result.errors) console.error(`env-consistency: ${err}`);
    process.exit(1);
  }
  console.log('env-consistency: ok');
}
