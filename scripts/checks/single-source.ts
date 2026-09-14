/**
 * Structural check: the node hierarchy is written down once.
 *
 * `LEGAL_PARENT_TYPES` (docs/SPECS.md §3.1) was written down twice before
 * it was written down once — `move.ts` and `reorder.ts` each carried a
 * private, character-identical literal with nothing comparing them, which
 * is docs/TODO.md's own named recurring defect. It now lives in
 * `packages/core/src/nodes/hierarchy.ts` and four packages read it.
 *
 * ── Why this check exists here, and not only in packages/db ────────────
 *
 * The guard was a test — `packages/db/src/nodes/single-source.test.ts` —
 * so alone among this repository's structural invariants it ran neither in
 * `bun run check` nor in `.githooks/pre-commit`, and it needed a Postgres
 * to run at all. Placement caused both of its holes:
 *
 *   1. Its textual scan read `import.meta.dir` with a NON-RECURSIVE
 *      `readdirSync`, so it saw one directory: `packages/db/src/nodes`. A
 *      second copy in `apps/api/src/routes/tree.ts`, `packages/contracts`
 *      or `apps/web` — exactly where a "the client needs the table too"
 *      copy lands — was invisible. Measured: its own regex matches such a
 *      copy; the scan simply never reads the file.
 *
 *   2. Its semantic assertion was
 *      `legalParentTypesUsedBy()[c].includes(p)` vs
 *      `isLegalParentType(c, p)` — but the accessor RETURNS
 *      `LEGAL_PARENT_TYPES` and the predicate READS it, so both sides are
 *      one object read twice: `X.includes(p) === X.includes(p)`. Measured:
 *      rewriting `LEGAL_PARENT_TYPES.page` to every node type leaves its
 *      25-iteration loop reporting zero mismatches.
 *
 * This check is the same rule, run by `bun run check` with no database,
 * over every workspace member recursively — and its semantic half states
 * properties the table must have rather than restating the table, because
 * a second literal of `LEGAL_PARENT_TYPES` inside a check that forbids
 * second literals of `LEGAL_PARENT_TYPES` is the defect wearing a hat.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { LEGAL_PARENT_TYPES, NODE_TYPES, type NodeType } from '../../packages/core/src/nodes/hierarchy';

export interface SingleSourceResult {
  ok: boolean;
  errors: string[];
}

/** The one module allowed to declare the table and the node-type union. */
const SOURCE_MODULE = 'packages/core/src/nodes/hierarchy.ts';

/** `LEGAL_PARENT_TYPES = {` / `LEGAL_PARENT_TYPES: Record<…> = {` — a declaration, not a re-export. */
const TABLE_DECLARATION = /\bLEGAL_PARENT_TYPES\s*(?::[^=]*)?=\s*\{/;

/** `type NodeType = 'workspace'` — the union restated instead of imported. */
const UNION_DECLARATION = /\btype\s+NodeType\s*=\s*['"]workspace['"]/;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.vue', '.js', '.mjs']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.output', '.git', 'drizzle', '__fixtures__']);
const MEMBER_GROUPS = ['apps', 'packages'];

/**
 * A check that describes a forbidden pattern necessarily contains it — the
 * exemption `single-parser.ts` and `query-boundaries.ts` both already use.
 * `packages/db/src/nodes/single-source.test.ts` is exempt for the same
 * reason: it carries the regex as a string.
 */
export function isSelfReferential(relPath: string): boolean {
  return /(^|\/)single-source(\.test)?\.ts$/.test(relPath);
}

function collectSourceFiles(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(root, entry);
    if (statSync(full).isDirectory()) collectSourceFiles(full, acc);
    else if (SOURCE_EXTENSIONS.has(extname(entry))) acc.push(full);
  }
  return acc;
}

/**
 * Rule 1, recursively, over every workspace member — not one directory.
 */
export function checkNoSecondTable(root: string): SingleSourceResult {
  const errors: string[] = [];

  for (const group of MEMBER_GROUPS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir) || !statSync(groupDir).isDirectory()) continue;

    for (const file of collectSourceFiles(groupDir)) {
      const rel = relative(root, file).split('\\').join('/');
      if (rel === SOURCE_MODULE || isSelfReferential(rel)) continue;

      const source = readFileSync(file, 'utf8');

      if (TABLE_DECLARATION.test(source)) {
        errors.push(
          `${rel} declares its own LEGAL_PARENT_TYPES table. ${SOURCE_MODULE} is the single source ` +
            `(docs/SPECS.md §3.1); import it — packages/contracts already re-exports it so a client needs ` +
            `no second dependency. The same fact in two places with nothing comparing them is this ` +
            `repository's named recurring defect.`,
        );
      }

      if (UNION_DECLARATION.test(source)) {
        errors.push(
          `${rel} re-declares the NodeType union. It is exported from ${SOURCE_MODULE}; a restated union ` +
            `drifts from the table the moment a sixth node type is added to one of them.`,
        );
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Rule 2: properties of the table itself.
 *
 * Deliberately NOT "the table equals this literal" — that would be a second
 * copy of the very fact this check protects, and it would have to be edited
 * in lockstep with the real one, which is the defect. These are the
 * properties that make the table a hierarchy at all, and each is broken by
 * a real mutation:
 *
 *   H1  every node type appears exactly once as a key;
 *   H2  every parent named is a real node type;
 *   H3  the root has no parent (a workspace is nobody's child);
 *   H4  no type is legal under EVERY type — the mutation that left the old
 *       25-iteration loop green. A total relation is not a hierarchy, it is
 *       the absence of one;
 *   H5  no cycles, direct or mutual: a type may not be its own ancestor.
 */
export function checkTableIsAHierarchy(
  table: Readonly<Record<string, readonly string[]>>,
  nodeTypes: readonly string[],
): SingleSourceResult {
  const errors: string[] = [];

  // H1
  for (const type of nodeTypes) {
    if (!Object.prototype.hasOwnProperty.call(table, type)) {
      errors.push(`LEGAL_PARENT_TYPES has no entry for the node type "${type}" — every type must say what may parent it, even if the answer is nothing.`);
    }
  }
  for (const key of Object.keys(table)) {
    if (!nodeTypes.includes(key)) {
      errors.push(`LEGAL_PARENT_TYPES has an entry for "${key}", which is not in NODE_TYPES.`);
    }
  }

  // H2
  for (const [child, parents] of Object.entries(table)) {
    for (const parent of parents) {
      if (!nodeTypes.includes(parent)) {
        errors.push(`LEGAL_PARENT_TYPES.${child} names "${parent}" as a legal parent, which is not a node type.`);
      }
    }
  }

  // H3 — the root of the tree is the type nothing may parent.
  const root = nodeTypes[0];
  if (root !== undefined && (table[root]?.length ?? 0) > 0) {
    errors.push(
      `LEGAL_PARENT_TYPES.${root} is not empty. "${root}" is the root of the tree (NODE_TYPES is root-first); ` +
        `giving it a parent makes the hierarchy a graph and every path-building query unbounded.`,
    );
  }

  // H4 — the mutation the old tautological assertion could not see.
  for (const [child, parents] of Object.entries(table)) {
    const distinct = new Set(parents);
    if (nodeTypes.length > 0 && nodeTypes.every((type) => distinct.has(type))) {
      errors.push(
        `LEGAL_PARENT_TYPES.${child} accepts every node type as a parent. A relation that permits everything ` +
          `is not a hierarchy — it is the absence of one, and it silently legalises every move the API exists ` +
          `to refuse.`,
      );
    }
  }

  // H5 — no type is its own ancestor.
  for (const start of nodeTypes) {
    const seen = new Set<string>();
    const queue = [...(table[start] ?? [])];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === start) {
        errors.push(
          `LEGAL_PARENT_TYPES makes "${start}" its own ancestor. A cycle in the parent relation means a node ` +
            `can be moved beneath its own descendant, which detaches a whole subtree from the root.`,
        );
        break;
      }
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(table[current] ?? []));
    }
  }

  return { ok: errors.length === 0, errors };
}

export function checkSingleSource(root: string): SingleSourceResult {
  const errors = [
    ...checkNoSecondTable(root).errors,
    ...checkTableIsAHierarchy(LEGAL_PARENT_TYPES as Record<NodeType, readonly NodeType[]>, NODE_TYPES).errors,
  ];
  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const result = checkSingleSource(root);
  if (!result.ok) {
    for (const err of result.errors) console.error(`single-source: ${err}`);
    process.exit(1);
  }
  console.log('single-source: ok');
}
