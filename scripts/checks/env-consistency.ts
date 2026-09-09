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
 * `APP_URL` is deliberately NOT compared against `PORT`, and it is compared
 * against apps/web's own dev-server port instead. It is the browser's origin
 * for apps/web — the CORS allowlist entry and the host of the
 * `/reset-password` and `/invite/accept` links mailed to users. Tying it to
 * the API's port is the mistake this comment exists to prevent; leaving it
 * tied to *nothing* was the gap that let it ship wrong.
 *
 * ## Why a wrong APP_URL is worse than a wrong port
 *
 * Every other pair here fails loudly *and honestly*: the connection is
 * refused, or it lands on another project's service and that service
 * complains. `APP_URL` fails loudly and blames the wrong thing. `apps/api`
 * installs `cors({ origin: APP_URL, credentials: true })`, so the API allows
 * exactly one origin through CORS with credentials. Name a different one and
 * the browser refuses the credentialed sign-in request *before the page sees
 * any response*: Chromium logs `net::ERR_FAILED`, Firefox
 * `NS_ERROR_DOM_BAD_URI`, the `fetch` rejects, no cookie is stored, and the
 * sign-in form shows "Could not reach the server. Check your connection and
 * try again."
 *
 * There is no 200 to read, because the request is refused rather than
 * answered. That is the trap, and it is not silence but misdirection: the
 * screen blames the connection, the connection is fine, and neither server
 * logs anything about CORS — so the search starts in the wrong place.
 * Measured 2026-09-09 in both browsers against a live stack. Until then this
 * header and the message below claimed the opposite — "login returns 200",
 * "nothing reports an error" — and both halves were wrong.
 *
 * `env.example` shipped `APP_URL=http://localhost:4173` against a dev server
 * that does not listen there. 4173 is Vite's preview port, and it is also
 * `MAIN_CHECKOUT_PORTS.web` in `packages/db/testing/worktree.ts` — the *e2e
 * harness's* web port for the main checkout. It was never the dev server's.
 *
 * ## What it is tied to now
 *
 * `apps/web/nuxt.config.ts` declares `devServer.port`, and that declaration
 * is the single source of truth for where apps/web listens in development.
 * This check reads it out of the file (text, never executed) and requires
 * `APP_URL` to name the same port. Two servers may not be given one port
 * either, so the declared web port is also required to differ from `PORT`.
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

/**
 * The port `apps/web/nuxt.config.ts` declares for its dev server, read out
 * of the file's text. Deliberately not `import()`ed: a Nuxt config is
 * evaluated by Nuxt, not by a check script, and executing it here would
 * pull the whole framework into `bun run env:check`.
 */
const DEV_SERVER_PORT = /devServer\s*:\s*\{[^}]*?\bport\s*:\s*(\d+)/s;

export function parseWebDevPort(source: string): number | undefined {
  const match = DEV_SERVER_PORT.exec(source);
  if (!match?.[1]) return undefined;
  return Number(match[1]);
}

export interface EnvConsistencyOptions {
  /** Where apps/web listens, from `parseWebDevPort`. Omitted, the APP_URL rules do not run. */
  readonly webDevPort?: number;
}

/**
 * The symptom, in the words of what the owner actually sees on the screen. A
 * message that says only "these two numbers differ" describes the cause of a
 * failure nobody has connected to this file yet — and this failure arrives
 * wearing another failure's clothes, so naming the wrong-looking sentence the
 * browser shows is the whole point.
 */
const SESSION_SYMPTOM =
  'The API allows exactly one origin through CORS with credentials, so the browser will ' +
  'refuse the credentialed sign-in request before the page sees any response ' +
  '(net::ERR_FAILED in Chromium, NS_ERROR_DOM_BAD_URI in Firefox): no cookie is stored, ' +
  'and the form shows "Could not reach the server. Check your connection and try again." ' +
  'That message is the trap — the screen blames the connection, the connection is fine, ' +
  'and neither server logs anything about CORS.';

export function checkEnvConsistency(
  env: Map<string, string>,
  options: EnvConsistencyOptions = {},
): EnvConsistencyResult {
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

  const { webDevPort } = options;

  if (webDevPort !== undefined) {
    // A deployed APP_URL names no port (`https://wiki.example.com`), and a
    // reverse proxy in front of both apps is none of this rule's business.
    // Only an origin that spells a port out can disagree with one.
    const appUrl = env.get('APP_URL');
    const appUrlPort = appUrl ? portOfUrl(appUrl) : undefined;

    if (appUrlPort !== undefined && appUrlPort !== String(webDevPort)) {
      errors.push(
        `APP_URL points at port ${appUrlPort}, but apps/web serves on ${webDevPort} ` +
          `(devServer.port in apps/web/nuxt.config.ts). ${SESSION_SYMPTOM} ` +
          `Set APP_URL to http://localhost:${webDevPort}.`,
      );
    }

    const apiPort = env.get('PORT');
    if (apiPort && apiPort === String(webDevPort)) {
      errors.push(
        `apps/web and apps/api are both given the same port (${webDevPort}). ` +
          `Only one of them can have it: the second to start either fails to bind or is ` +
          `silently moved to another port, and APP_URL then names whichever one lost. ` +
          `Give apps/api a different PORT, or change devServer.port in apps/web/nuxt.config.ts.`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();

  const nuxtConfigPath = join(root, 'apps', 'web', 'nuxt.config.ts');
  const webDevPort = existsSync(nuxtConfigPath)
    ? parseWebDevPort(readFileSync(nuxtConfigPath, 'utf8'))
    : undefined;

  if (webDevPort === undefined) {
    // Not a warning. APP_URL has no other anchor, and it was unanchored that
    // it shipped pointing at the e2e harness's port.
    console.error(
      'env-consistency: apps/web/nuxt.config.ts declares no devServer.port, so there is ' +
        'nothing to check APP_URL against. Declare it — it is the one place that says where ' +
        'apps/web listens, and APP_URL has to name the same origin.',
    );
    process.exit(1);
  }

  /**
   * `env.example` is checked as well as `.env`, and always. It is committed
   * repository state, every developer copies it, and the shipped default is
   * where the wrong APP_URL came from — so a fresh clone with no `.env` at
   * all must still be able to fail here.
   */
  const files = [
    { label: 'env.example', path: join(root, 'env.example') },
    { label: '.env', path: join(root, '.env') },
  ].filter((file) => existsSync(file.path));

  let ok = true;
  for (const file of files) {
    const result = checkEnvConsistency(parseEnv(readFileSync(file.path, 'utf8')), { webDevPort });
    for (const err of result.errors) console.error(`env-consistency: ${file.label}: ${err}`);
    ok &&= result.ok;
  }

  if (!ok) process.exit(1);

  // A fresh clone has no .env yet; that is env-example.ts's business.
  console.log(`env-consistency: ok (${files.map((file) => file.label).join(', ')})`);
}
