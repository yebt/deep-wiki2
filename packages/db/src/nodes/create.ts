/**
 * Node creation — the write that makes deep-wiki a wiki rather than a
 * reader (docs/SPECS.md §3.1).
 *
 * Everything structural here is borrowed rather than restated:
 *
 * - **Which type may parent which** comes from `assertLegalParent()`, the
 *   same call `move.ts` and `reorder.ts` make, which reads the one table
 *   in `packages/core/src/nodes/hierarchy.ts`. Creating a book under a
 *   page is refused by the table that refuses moving one there.
 * - **The tenant** comes from the parent row, never from the caller. The
 *   composite `(id, workspace_id)` foreign key makes a cross-tenant child
 *   structurally unrepresentable; taking `workspace_id` from an argument
 *   would be the one way to hand the database a row it would then have to
 *   reject.
 * - **`path`** is written by the `nodes_set_path` trigger (design.md D3),
 *   so the INSERT supplies `''` exactly as `seed.ts` and `moveNode` do.
 * - **The workspace row lock** is the same portable `SELECT ... FOR
 *   UPDATE` idiom `moveNode`, `reorderNode` and `createWorkspace` use. It
 *   is what makes "is this name taken?" and the INSERT one decision: two
 *   people creating "Overview" in the same chapter at the same instant
 *   serialise, so the second one gets `DuplicateSiblingSlugError` and a
 *   sentence, rather than a raw 23505 unique violation.
 *
 * ── The name collision, and why it is a refusal ────────────────────────
 *
 * `nodes_parent_slug_live_idx (parent_id, slug) WHERE trashed_at IS NULL`
 * (deletion-and-trash design.md Decision 1 — replaces the earlier
 * unconditional `nodes_parent_slug_unique`) is the constraint
 * `packages/db/seed.ts` already looks a node up by, so two *live* siblings
 * cannot share a slug; a trashed one frees its name. Two answers were
 * available: silently uniquify ("overview" → "overview-2"), or refuse and
 * say so. This module refuses.
 *
 * Uniquifying is the quieter code and the worse product: the user typed a
 * name, and a wiki that stores a *different* name than the one typed —
 * without saying so — produces a tree with two rows reading "Overview"
 * and a URL nobody predicted. The collision is also information the user
 * wants: in a wiki, two siblings with the same name is nearly always a
 * mistake or a duplicate someone else already made.
 *
 * One residual disclosure is recorded rather than hidden: a caller with
 * `write` on a parent but no `read` on one of its children learns that
 * *some* sibling holds that slug. It is bounded (the caller can already
 * read and write the parent) and unavoidable while the constraint exists
 * — the insert would fail either way — but it is a real edge, noted in
 * docs/TODO.md.
 */
import { slugifyTitle, type NodeType } from '@deep-wiki/core';
import type postgres from 'postgres';
import { assertLegalParent } from './legal-parent-types';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export class ParentNodeNotFoundError extends Error {
  readonly parentId: string;

  constructor(parentId: string) {
    super(`node ${parentId} does not exist`);
    this.name = 'ParentNodeNotFoundError';
    this.parentId = parentId;
  }
}

/** A sibling already holds the slug this title derives to. Carries the name the user typed, so the message can quote it back. */
export class DuplicateSiblingSlugError extends Error {
  readonly slug: string;
  readonly title: string;

  constructor(title: string, slug: string) {
    super(`a sibling named "${title}" already exists here`);
    this.name = 'DuplicateSiblingSlugError';
    this.title = title;
    this.slug = slug;
  }
}

/** The title contains no letter or number, so it has no slug. Refused rather than replaced with an invented one. */
export class UnslugifiableTitleError extends Error {
  readonly title: string;

  constructor(title: string) {
    super('a name must contain at least one letter or number');
    this.name = 'UnslugifiableTitleError';
    this.title = title;
  }
}

export interface CreateNodeInput {
  readonly parentId: string;
  readonly type: NodeType;
  readonly title: string;
}

export interface CreatedNode {
  readonly id: string;
  readonly workspaceId: string;
  readonly parentId: string;
  readonly type: NodeType;
  readonly slug: string;
  readonly title: string;
  readonly position: number;
}

interface ParentRow {
  id: string;
  workspace_id: string;
  type: NodeType;
}

/**
 * Derives the slug and proves it is free among `parentId`'s children.
 * Shared with `rename.ts`, which faces the identical question one row
 * later — the collision rule exists once.
 */
export async function resolveSiblingSlug(
  tx: SqlExecutor,
  input: { readonly parentId: string; readonly title: string; readonly exceptNodeId?: string },
): Promise<string> {
  const slug = slugifyTitle(input.title);
  if (slug === '') {
    throw new UnslugifiableTitleError(input.title);
  }

  const exceptId = input.exceptNodeId ?? null;
  const taken = await tx<{ id: string }[]>`
    SELECT id FROM live_nodes
     WHERE parent_id = ${input.parentId}
       AND slug = ${slug}
       AND (${exceptId}::uuid IS NULL OR id <> ${exceptId}::uuid)
     LIMIT 1
  `;
  if (taken.length > 0) {
    throw new DuplicateSiblingSlugError(input.title, slug);
  }

  return slug;
}

export async function createNode(sql: postgres.Sql, input: CreateNodeInput): Promise<CreatedNode> {
  return sql.begin(async (tx) => {
    const [parent] = await tx<ParentRow[]>`
      SELECT id, workspace_id, type FROM live_nodes WHERE id = ${input.parentId}
    `;
    if (!parent) {
      throw new ParentNodeNotFoundError(input.parentId);
    }

    // Serialises creation within this workspace, so the uniqueness check
    // below and the INSERT are one decision rather than two.
    await tx`SELECT id FROM workspaces WHERE id = ${parent.workspace_id} FOR UPDATE`;

    assertLegalParent(input.type, parent.type);

    const slug = await resolveSiblingSlug(tx, { parentId: parent.id, title: input.title });

    const positionRows = await tx<{ next_position: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM live_nodes WHERE parent_id = ${parent.id}
    `;
    const position = positionRows[0]!.next_position;

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${parent.workspace_id}, ${parent.id}, ${input.type}::node_type, '', ${position}, ${slug}, ${input.title})
      RETURNING id
    `;

    return {
      id: row!.id,
      workspaceId: parent.workspace_id,
      parentId: parent.id,
      type: input.type,
      slug,
      title: input.title,
      position,
    };
  });
}
