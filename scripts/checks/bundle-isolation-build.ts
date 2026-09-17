/**
 * Layer 3 of "Read mode never reaches the ProseMirror bundle" (design.md,
 * document-modes spec: "ProseMirror Bundle Isolation Is Verified By Build
 * Output"). Layer 2 (`bundle-isolation.ts`) proves the SOURCE never names
 * a forbidden package; this layer proves the BUILT OUTPUT never bundles
 * one into the read route's own chunk either, by walking the read route's
 * actual chunk graph after a real `nuxt build` and asserting none of its
 * STATIC imports (never `dynamicImports`) reach a ProseMirror, Milkdown or
 * TipTap module. `dynamicImports` is deliberately excluded: the async
 * edit chunk legitimately exists once WU-16 wires it up, and it must not
 * fail this check (design.md's own stated risk, "the async edit chunk
 * legitimately exists").
 *
 * Reads Nuxt's own SSR chunk-graph precomputation
 * (`.output/server/chunks/virtual/precomputed.mjs`, exported as
 * `client_precomputed`) rather than re-deriving a manifest from scratch:
 * it already carries exactly what this check needs per reached module —
 * `imports`, `dynamicImports`, `name`, `src`, `file` — because
 * Nuxt/vue-bundle-renderer builds it for SSR preload/prefetch link
 * generation. Verified directly against a real build of this app's
 * installed Nuxt/Nitro version (2026-09-06); if a future Nuxt release
 * changes this file's shape, this check fails loudly — a missing file or
 * a missing route entry — rather than silently passing.
 *
 * A second assertion over the same build (2026-09-16, docs/TODO.md "no
 * data layer: measured and fixed"): no client chunk under
 * `.output/public/_nuxt` may carry the server env schema. Until
 * `packages/contracts` grew its `./env` subpath export, the barrel
 * re-exported `envSchema`, and every page's shared chunk shipped the zod
 * schema of every server-side variable — 263 KB raw / 75 KB gzipped, with
 * `AI_KEK_*` and `DATABASE_URL` spelled out in it. Those names have no
 * business in a browser; `AI_KEK` is the fingerprint this scans for.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pageUrl } from '../../apps/web/app/utils/routes';

export interface BuildOutputIsolationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly skipped?: string;
  /** How many client chunks the server-env scan read — so a green result can be told from a scan that found nothing to read. */
  readonly scannedClientChunks?: number;
}

const FORBIDDEN_PATTERN = /prosemirror|milkdown|tiptap/i;

/** A server-side variable name that exists only in `packages/contracts/src/env.ts` — the leak's fingerprint. */
const SERVER_ENV_FINGERPRINT = 'AI_KEK';

/**
 * Every JavaScript chunk a browser can download from the build, scanned
 * for the server env schema's fingerprint. Returns one error per chunk
 * that carries it, and the number of chunks read.
 */
function scanClientChunksForServerEnv(webRoot: string): { readonly errors: string[]; readonly scanned: number } {
  const chunksDir = join(webRoot, '.output', 'public', '_nuxt');
  if (!existsSync(chunksDir)) return { errors: [], scanned: 0 };
  const errors: string[] = [];
  let scanned = 0;
  for (const name of readdirSync(chunksDir)) {
    if (!name.endsWith('.js')) continue;
    scanned += 1;
    if (readFileSync(join(chunksDir, name), 'utf8').includes(SERVER_ENV_FINGERPRINT)) {
      errors.push(
        `client chunk "${name}" carries "${SERVER_ENV_FINGERPRINT}" — the server env schema (packages/contracts/src/env.ts) is in a ` +
          'bundle the browser downloads; import it from "@deep-wiki/contracts/env" on the server only, never through the contracts barrel',
      );
    }
  }
  return { errors, scanned };
}

/**
 * The read route's source path, as the chunk graph keys it
 * (`pages/<path under app/pages>`), derived rather than spelled: the
 * check is deliberately route-specific — one route, one entry, failures
 * that name exactly one thing — and a string constant here was the
 * second copy of where that route lives. The routes batch (2026-09-17)
 * moved the file from `pages/pages/[id]/` to `pages/w/[workspace]/p/[id]/`
 * and the constant stayed, so the check failed against every build with
 * "has the read route moved?". Now `utils/routes.ts` says what a page's
 * address is (`pageUrl`), the pages directory says which file serves
 * it, and this walks the second for the first. `null` when no file does
 * — the caller fails loudly with the address it was looking for.
 */
export function readRouteSource(pagesDir: string): string | null {
  if (!existsSync(pagesDir)) return null;
  const address = pageUrl(SAMPLE_SLUG, SAMPLE_ID);
  for (const file of walkVueFiles(pagesDir)) {
    const under = relative(pagesDir, file).split(sep).join('/');
    if (nuxtRoutePattern(under).test(address)) return `pages/${under}`;
  }
  return null;
}

/** A slug and an id in the shapes `routes.ts` documents, so `pageUrl()` yields an address a route pattern can be matched against. */
const SAMPLE_SLUG = 'acme';
const SAMPLE_ID = '0f3e2a9c-7b1d-4c5e-8a2f-1d2e3f4a5b6c';

/**
 * The route a Nuxt pages file serves, as a whole-path regex: `index.vue`
 * is its directory, `[name]` is one segment, `[...name]` is the rest,
 * `[[name]]` is optional. Enough of Nuxt's file-to-route rule for this
 * app's pages; a segment shape it does not know matches literally.
 */
function nuxtRoutePattern(fileUnderPages: string): RegExp {
  const route = fileUnderPages.replace(/\.vue$/, '').replace(/(^|\/)index$/, '');
  const segments = route
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return '.+';
      if (/^\[\[[^\]]+\]\]$/.test(segment)) return '(?:[^/]+)?';
      if (/^\[[^\]]+\]$/.test(segment)) return '[^/]+';
      return segment.replace(/[.*+?^${}()|\\]/g, '\\$&');
    });
  return new RegExp(`^/${segments.join('/')}/?$`);
}

function walkVueFiles(dir: string, into: string[] = []): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkVueFiles(full, into);
    else if (entry.endsWith('.vue')) into.push(full);
  }
  return into;
}

interface PreloadNode {
  readonly name?: string;
  readonly src?: string;
  readonly file?: string;
  readonly imports?: readonly string[];
}

interface PrecomputedModule {
  readonly default: {
    readonly dependencies: Record<string, { readonly preload: Record<string, PreloadNode> }>;
  };
}

export async function checkBuildOutputIsolation(webRoot: string): Promise<BuildOutputIsolationResult> {
  const precomputedPath = join(webRoot, '.output', 'server', 'chunks', 'virtual', 'precomputed.mjs');
  if (!existsSync(precomputedPath)) {
    return {
      ok: true,
      errors: [],
      skipped: `no build output at ${precomputedPath} — run "bun run -F @deep-wiki/web build" first, then re-run this check`,
    };
  }

  // `import()` resolves a bare relative path against the *importing
  // module* (this file), not the process cwd or `webRoot` — an absolute
  // file:// URL is what makes this work regardless of where `webRoot`
  // points or where this script itself is invoked from.
  const readRouteSrc = readRouteSource(join(webRoot, 'app', 'pages'));
  if (!readRouteSrc) {
    return {
      ok: false,
      errors: [
        `no file under app/pages serves ${pageUrl('<slug>', '<id>')}, the page address utils/routes.ts emits — ` +
          'has the read route moved without pageUrl() following, or pageUrl() changed without the file?',
      ],
    };
  }

  const mod = (await import(pathToFileURL(resolve(precomputedPath)).href)) as PrecomputedModule;
  const routeEntry = mod.default.dependencies[readRouteSrc];
  if (!routeEntry) {
    return {
      ok: false,
      errors: [`no "${readRouteSrc}" entry in the build's client chunk graph — is the build output stale, or does Nuxt key its chunk graph differently now?`],
    };
  }

  const preload = routeEntry.preload;
  const errors: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [readRouteSrc];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);

    const node = preload[id];
    if (!node) continue;

    for (const label of [node.name, node.src, node.file, id]) {
      if (label && FORBIDDEN_PATTERN.test(label)) {
        errors.push(
          `the read route's built chunk graph statically reaches "${label}" — a ProseMirror/Milkdown/TipTap module leaked into a ` +
            'chunk the read route loads eagerly (only a dynamic import(), reached via dynamicImports, is allowed to carry the editor)',
        );
      }
    }

    // dynamicImports is intentionally never enqueued here — see the module
    // doc comment above.
    for (const next of node.imports ?? []) {
      queue.push(next);
    }
  }

  const serverEnv = scanClientChunksForServerEnv(webRoot);
  errors.push(...serverEnv.errors);

  return { ok: errors.length === 0, errors, scannedClientChunks: serverEnv.scanned };
}

if (import.meta.main) {
  const webRoot = process.argv[2] ?? join(process.cwd(), 'apps', 'web');
  const result = await checkBuildOutputIsolation(webRoot);
  if (result.skipped) {
    console.log(`bundle-isolation-build: skipped — ${result.skipped}`);
    process.exit(0);
  }
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`bundle-isolation-build: ${err}`);
    }
    process.exit(1);
  }
  console.log(`bundle-isolation-build: ok (${result.scannedClientChunks ?? 0} client chunks scanned for the server env schema)`);
}
