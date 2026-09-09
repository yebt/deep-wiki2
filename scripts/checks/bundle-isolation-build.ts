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
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BuildOutputIsolationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly skipped?: string;
}

const FORBIDDEN_PATTERN = /prosemirror|milkdown|tiptap/i;

/** The read route this batch (WU-15) ships. A future route added alongside it needs its own entry here — the check is deliberately route-specific, not "every route", so it stays fast and its failures name exactly one thing. */
const READ_ROUTE_SRC = 'pages/pages/[id]/index.vue';

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
  const mod = (await import(pathToFileURL(resolve(precomputedPath)).href)) as PrecomputedModule;
  const routeEntry = mod.default.dependencies[READ_ROUTE_SRC];
  if (!routeEntry) {
    return {
      ok: false,
      errors: [`no "${READ_ROUTE_SRC}" entry in the build's client chunk graph — has the read route moved or been renamed?`],
    };
  }

  const preload = routeEntry.preload;
  const errors: string[] = [];
  const visited = new Set<string>();
  const queue: string[] = [READ_ROUTE_SRC];

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

  return { ok: errors.length === 0, errors };
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
  console.log('bundle-isolation-build: ok');
}
