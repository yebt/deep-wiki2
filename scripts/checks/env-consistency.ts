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
 *
 * ## The host, not only the port
 *
 * `APP_URL` was compared on its port alone until 2026-09-09, so
 * `http://example.com:3001` passed. The port was never the whole fact. An
 * origin is scheme + host + port, and it is the *origin* that
 * `cors({ origin: APP_URL })` allowlists and the *host* that the
 * `/reset-password` and `/invite/accept` links carry into somebody's inbox.
 * A right port on a wrong host fails exactly the way a wrong port does — the
 * browser refuses the credentialed request and the screen blames the
 * connection — and it additionally mails real people a link to a machine that
 * is not theirs. So when `APP_URL` spells a port out, its host must be
 * `localhost`: that is what `nuxt dev` prints and what the developer opens.
 *
 * `127.0.0.1` is refused with the rest. It is the same machine and a
 * *different origin*: browsers compare origins as text, so a page served from
 * `http://localhost:3001` and an allowlist entry of `http://127.0.0.1:3001`
 * produce the same CORS refusal as any other mismatch.
 *
 * ## Half a pair is a drift, not a configuration
 *
 * Each entry in `PAIRS` is one fact written twice. Until 2026-09-09 a
 * missing or portless half made the rule `continue` — so a `DATABASE_URL`
 * with no port at all, sitting beside `POSTGRES_HOST_PORT=25432`, returned
 * ok. That is precisely the worst case the top of this header describes, and
 * the check was silent about it. Both halves present, or neither: half is now
 * an error.
 *
 * A portless consumed value is an error too, because portless does not mean
 * "no port" — it means the scheme's default, and that default is the exact
 * number the published half exists to move. `postgres://u:p@localhost/db` is
 * 5432; `http://localhost` is 80. Neither has a legitimate reading here: if a
 * deployment really is reaching a service on the default port through a
 * reverse proxy, then it is not running the compose stack either, and its
 * `POSTGRES_HOST_PORT` / `PORT` are absent — which is the "neither" case and
 * passes untouched. The portless exemption above is `APP_URL`'s alone; it was
 * written for a deployed origin behind a proxy and it does not generalise to
 * a connection string.
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

function hostOfUrl(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The host `apps/web` is reached on in development. `nuxt dev` binds the
 * loopback interface and prints `localhost`, and an origin is compared as
 * text, so this is the only host an `APP_URL` that spells a dev-server port
 * out can name.
 */
const WEB_DEV_HOST = 'localhost';

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

    // Neither half written is not this rule's business: the pair describes
    // the local compose stack, and a deployment that does not run it declares
    // neither side.
    if (!published && !consumed) continue;

    if (!published || !consumed) {
      const [present, absent] = published ? [pair.publish, pair.consume] : [pair.consume, pair.publish];
      errors.push(
        `${present}=${published || consumed} is set, but ${absent} is not set at all. ` +
          `These two are the same fact written twice — one says where the service listens or is ` +
          `published, the other says where to reach it — so half of it is a drift that has already ` +
          `happened, not a configuration. Whichever side is missing falls back to a default nobody ` +
          `chose, and the connection then lands on whatever owns that port. Write both, or neither.`,
      );
      continue;
    }

    const actual = pair.kind === 'url' ? portOfUrl(consumed) : consumed;
    if (!actual) {
      errors.push(
        `${pair.publish}=${published} but ${pair.consume}=${consumed} declares no port at all. ` +
          `That is not "no port": it is the scheme's default — 5432 for postgres, 80 or 443 for ` +
          `http — which is the very number ${pair.publish} exists to move. Nothing published on ` +
          `${published} is ever reached, and the connection lands on whatever already owns the ` +
          `default. Spell the port out: ${pair.hint} must read ${published}.`,
      );
      continue;
    }

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
    const appUrlHost = appUrl ? hostOfUrl(appUrl) : undefined;

    // The host is checked on the same terms as the port, and only when a port
    // is spelled out — a portless APP_URL is the deployed case above.
    if (appUrlPort !== undefined && appUrlHost !== undefined && appUrlHost !== WEB_DEV_HOST) {
      errors.push(
        `APP_URL names the host ${appUrlHost}, but apps/web is served from ${WEB_DEV_HOST} in ` +
          `development. An origin is scheme + host + port, and this one is wrong on the host: ` +
          `${SESSION_SYMPTOM} ` +
          `The mailed /reset-password and /invite/accept links carry this host too, so they will ` +
          `point at ${appUrlHost} rather than at the machine the developer is running. ` +
          `(${appUrlHost} and ${WEB_DEV_HOST} may even be the same machine — 127.0.0.1 is — and it ` +
          `changes nothing: the browser compares origins as text.) ` +
          `Set APP_URL to http://${WEB_DEV_HOST}:${webDevPort}.`,
      );
    }

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
