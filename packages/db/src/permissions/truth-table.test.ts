/**
 * GATE-1 — the permission resolver truth table (~30 cases against real
 * Postgres, never `describe.skipIf` — design.md D15). One seeded fixture
 * tree, one seed, no per-case teardown (mid-scenario mutations for D5 and
 * E4 are part of those scenarios' own GIVEN clause: a revocation). See
 * openspec/changes/tenancy-and-permissions/specs/permission-resolver/spec.md
 * for the acceptance criteria each case proves.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { can } from '@deep-wiki/core';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { createGrantLookup } from './queries';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

interface NodeRow {
  id: string;
  path: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<NodeRow> {
  const [row] = await sql<NodeRow[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id, path
  `;
  return row!;
}

async function insertUser(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${slug}-${crypto.randomUUID()}@example.com`}, 'hash', ${slug})
    RETURNING id
  `;
  return row!.id;
}

async function insertWorkspace(ownerId: string, slug: string): Promise<NodeRow & { workspaceId: string }> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${slug}, ${`${slug}-${crypto.randomUUID()}`})
    RETURNING id
  `;
  const root = await insertNode(ws!.id, null, 'workspace', `${slug}-root`);
  return { ...root, workspaceId: ws!.id };
}

async function insertCell(workspaceId: string, slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO cells (workspace_id, name) VALUES (${workspaceId}, ${`${slug}-${crypto.randomUUID()}`}) RETURNING id
  `;
  return row!.id;
}

async function addCellMember(cellId: string, userId: string, workspaceId: string): Promise<void> {
  await sql`INSERT INTO cell_members (cell_id, user_id, workspace_id) VALUES (${cellId}, ${userId}, ${workspaceId})`;
}

async function grant(
  workspaceId: string,
  subjectType: 'user' | 'cell' | 'agent',
  subjectId: string,
  resourceId: string,
  action: 'read' | 'comment' | 'write' | 'manage',
  effect: 'allow' | 'deny',
): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, ${subjectType}::subject_kind, ${subjectId}, ${resourceId}, ${action}::perm_action, ${effect}::perm_effect)
  `;
}

async function canRead(subjectType: 'user' | 'cell' | 'agent', subjectId: string, resourceId: string, action: 'read' | 'comment' | 'write' | 'manage' = 'read'): Promise<boolean> {
  return can(createGrantLookup(sql), { subjectType, subjectId, resourceId, action });
}

// ---------------------------------------------------------------------
// Fixture: one seed, no per-case teardown.
// ---------------------------------------------------------------------

let ownerId: string;
let ws: NodeRow & { workspaceId: string }; // workspace W
let shelf1: NodeRow;
let book1: NodeRow;
let chapter1: NodeRow;
let page1: NodeRow;
let book2: NodeRow; // sibling of book1, under shelf1 (A5 target)
let book3: NodeRow;
let chapter3: NodeRow;
let page3: NodeRow; // A6 chain

let ws2: NodeRow & { workspaceId: string }; // workspace W2, for cross-workspace cases
let ws2Book: NodeRow;

beforeAll(async () => {
  ownerId = await insertUser('owner');
  ws = await insertWorkspace(ownerId, 'gate1');
  shelf1 = await insertNode(ws.workspaceId, ws.id, 'shelf', 'shelf-1');
  book1 = await insertNode(ws.workspaceId, shelf1.id, 'book', 'book-1');
  chapter1 = await insertNode(ws.workspaceId, book1.id, 'chapter', 'chapter-1');
  page1 = await insertNode(ws.workspaceId, chapter1.id, 'page', 'page-1');
  book2 = await insertNode(ws.workspaceId, shelf1.id, 'book', 'book-2', 1);
  book3 = await insertNode(ws.workspaceId, shelf1.id, 'book', 'book-3', 2);
  chapter3 = await insertNode(ws.workspaceId, book3.id, 'chapter', 'chapter-3');
  page3 = await insertNode(ws.workspaceId, chapter3.id, 'page', 'page-3');

  ws2 = await insertWorkspace(ownerId, 'gate1-other');
  const shelf2 = await insertNode(ws2.workspaceId, ws2.id, 'shelf', 'shelf-2');
  ws2Book = await insertNode(ws2.workspaceId, shelf2.id, 'book', 'ws2-book');
});

describe('A — inheritance down each level', () => {
  test('A1: workspace-level allow reaches a shelf', async () => {
    const u = await insertUser('a1');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'allow');
    expect(await canRead('user', u, shelf1.id)).toBe(true);
  });

  test('A2: workspace-level allow reaches a book', async () => {
    const u = await insertUser('a2');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'allow');
    expect(await canRead('user', u, book1.id)).toBe(true);
  });

  test('A3: workspace-level allow reaches a chapter', async () => {
    const u = await insertUser('a3');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'allow');
    expect(await canRead('user', u, chapter1.id)).toBe(true);
  });

  test('A4: workspace-level allow reaches a page', async () => {
    const u = await insertUser('a4');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'allow');
    expect(await canRead('user', u, page1.id)).toBe(true);
  });

  test('A5: shelf-level allow reaches a nested book', async () => {
    const u = await insertUser('a5');
    await grant(ws.workspaceId, 'user', u, shelf1.id, 'read', 'allow');
    expect(await canRead('user', u, book2.id)).toBe(true);
  });

  test('A6: book-level allow reaches a page under a chapter', async () => {
    const u = await insertUser('a6');
    await grant(ws.workspaceId, 'user', u, book3.id, 'read', 'allow');
    expect(await canRead('user', u, page3.id)).toBe(true);
  });
});

describe('B — deny wins over allow at equal specificity', () => {
  test('B1: deny and allow at the workspace level', async () => {
    const u = await insertUser('b1');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'allow');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'deny');
    expect(await canRead('user', u, ws.id)).toBe(false);
  });

  test('B2: deny and allow on write directly on a page', async () => {
    const u = await insertUser('b2');
    await grant(ws.workspaceId, 'user', u, page1.id, 'write', 'allow');
    await grant(ws.workspaceId, 'user', u, page1.id, 'write', 'deny');
    expect(await canRead('user', u, page1.id, 'write')).toBe(false);
  });

  test('B3: direct allow versus cell deny at the same level (book)', async () => {
    const u = await insertUser('b3');
    const cell = await insertCell(ws.workspaceId, 'b3-cell');
    await addCellMember(cell, u, ws.workspaceId);
    await grant(ws.workspaceId, 'user', u, book1.id, 'comment', 'allow');
    await grant(ws.workspaceId, 'cell', cell, book1.id, 'comment', 'deny');
    expect(await canRead('user', u, book1.id, 'comment')).toBe(false);
  });

  test('B4: two grants at the chapter level for the same resolved subject set', async () => {
    const u = await insertUser('b4');
    await grant(ws.workspaceId, 'user', u, chapter1.id, 'manage', 'allow');
    await grant(ws.workspaceId, 'user', u, chapter1.id, 'manage', 'deny');
    expect(await canRead('user', u, chapter1.id, 'manage')).toBe(false);
  });
});

describe('C — more specific level overrides less specific', () => {
  test('C1: shelf allow overrides workspace deny', async () => {
    const u = await insertUser('c1');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'deny');
    await grant(ws.workspaceId, 'user', u, shelf1.id, 'read', 'allow');
    expect(await canRead('user', u, shelf1.id)).toBe(true);
  });

  test('C2: book allow overrides workspace deny', async () => {
    const u = await insertUser('c2');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'deny');
    await grant(ws.workspaceId, 'user', u, book1.id, 'read', 'allow');
    expect(await canRead('user', u, book1.id)).toBe(true);
  });

  test('C3: book allow overrides shelf deny', async () => {
    const u = await insertUser('c3');
    await grant(ws.workspaceId, 'user', u, shelf1.id, 'read', 'deny');
    await grant(ws.workspaceId, 'user', u, book1.id, 'read', 'allow');
    expect(await canRead('user', u, book1.id)).toBe(true);
  });

  test('C4: chapter allow overrides book deny', async () => {
    const u = await insertUser('c4');
    await grant(ws.workspaceId, 'user', u, book1.id, 'read', 'deny');
    await grant(ws.workspaceId, 'user', u, chapter1.id, 'read', 'allow');
    expect(await canRead('user', u, chapter1.id)).toBe(true);
  });

  test('C5: page allow overrides chapter deny', async () => {
    const u = await insertUser('c5');
    await grant(ws.workspaceId, 'user', u, chapter1.id, 'read', 'deny');
    await grant(ws.workspaceId, 'user', u, page1.id, 'read', 'allow');
    expect(await canRead('user', u, page1.id)).toBe(true);
  });
});

describe('D — cell/team-derived grants', () => {
  test('D1: cell grant reaches a member with no direct grant', async () => {
    const u = await insertUser('d1');
    const cell = await insertCell(ws.workspaceId, 'd1-cell');
    await addCellMember(cell, u, ws.workspaceId);
    await grant(ws.workspaceId, 'cell', cell, book1.id, 'read', 'allow');
    expect(await canRead('user', u, book1.id)).toBe(true);
  });

  test('D2: conflicting grants from two cells, same specificity', async () => {
    const u = await insertUser('d2');
    const cellAllow = await insertCell(ws.workspaceId, 'd2-allow');
    const cellDeny = await insertCell(ws.workspaceId, 'd2-deny');
    await addCellMember(cellAllow, u, ws.workspaceId);
    await addCellMember(cellDeny, u, ws.workspaceId);
    await grant(ws.workspaceId, 'cell', cellAllow, book2.id, 'comment', 'allow');
    await grant(ws.workspaceId, 'cell', cellDeny, book2.id, 'comment', 'deny');
    expect(await canRead('user', u, book2.id, 'comment')).toBe(false);
  });

  test('D3: direct allow versus cell deny, same specificity, on a page', async () => {
    const u = await insertUser('d3');
    const cell = await insertCell(ws.workspaceId, 'd3-cell');
    await addCellMember(cell, u, ws.workspaceId);
    await grant(ws.workspaceId, 'user', u, page3.id, 'read', 'allow');
    await grant(ws.workspaceId, 'cell', cell, page3.id, 'read', 'deny');
    expect(await canRead('user', u, page3.id)).toBe(false);
  });

  test('D4: cell allow at a more specific level overrides a direct deny', async () => {
    const u = await insertUser('d4');
    const cell = await insertCell(ws.workspaceId, 'd4-cell');
    await addCellMember(cell, u, ws.workspaceId);
    await grant(ws.workspaceId, 'user', u, book1.id, 'read', 'deny');
    await grant(ws.workspaceId, 'cell', cell, chapter1.id, 'read', 'allow');
    expect(await canRead('user', u, chapter1.id)).toBe(true);
  });

  test('D5: removed membership no longer grants access', async () => {
    const u = await insertUser('d5');
    const cell = await insertCell(ws.workspaceId, 'd5-cell');
    await addCellMember(cell, u, ws.workspaceId);
    await grant(ws.workspaceId, 'cell', cell, book3.id, 'read', 'allow');
    expect(await canRead('user', u, book3.id)).toBe(true);

    await sql`DELETE FROM cell_members WHERE cell_id = ${cell} AND user_id = ${u}`;

    expect(await canRead('user', u, book3.id)).toBe(false);
  });
});

describe('E — agent subject scoped to one book', () => {
  test('E1: agent allow reaches nested pages', async () => {
    const agentId = crypto.randomUUID();
    await grant(ws.workspaceId, 'agent', agentId, book1.id, 'read', 'allow');
    expect(await canRead('agent', agentId, page1.id)).toBe(true);
  });

  test('E2: agent has no reach into a sibling book', async () => {
    const agentId = crypto.randomUUID();
    await grant(ws.workspaceId, 'agent', agentId, book1.id, 'read', 'allow');
    expect(await canRead('agent', agentId, book2.id)).toBe(false);
  });

  test('E3: agent grant is action-specific', async () => {
    const agentId = crypto.randomUUID();
    await grant(ws.workspaceId, 'agent', agentId, book1.id, 'read', 'allow');
    expect(await canRead('agent', agentId, page1.id, 'write')).toBe(false);
  });

  test('E4: revoked agent grant', async () => {
    const agentId = crypto.randomUUID();
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws.workspaceId}, 'agent', ${agentId}, ${book2.id}, 'read', 'allow')
      RETURNING id
    `;
    expect(await canRead('agent', agentId, book2.id)).toBe(true);

    await sql`DELETE FROM permissions WHERE id = ${row!.id}`;

    expect(await canRead('agent', agentId, book2.id)).toBe(false);
  });
});

describe('F — cross-workspace isolation', () => {
  test('F1: no leak by coincidental resource shape', async () => {
    const u = await insertUser('f1');
    await grant(ws.workspaceId, 'user', u, book1.id, 'read', 'allow');
    expect(await canRead('user', u, ws2Book.id)).toBe(false);
  });

  test('F2: workspace admin has no cross-workspace reach', async () => {
    const u = await insertUser('f2');
    await grant(ws.workspaceId, 'user', u, ws.id, 'manage', 'allow');
    expect(await canRead('user', u, ws2.id, 'manage')).toBe(false);
  });

  test('F3: cell membership does not cross workspaces', async () => {
    const u = await insertUser('f3');
    const cell = await insertCell(ws.workspaceId, 'f3-cell');
    await addCellMember(cell, u, ws.workspaceId);
    await grant(ws.workspaceId, 'cell', cell, book1.id, 'read', 'allow');
    expect(await canRead('user', u, ws2Book.id)).toBe(false);
  });

  test('F4: agent scope does not cross workspaces', async () => {
    const agentId = crypto.randomUUID();
    await grant(ws.workspaceId, 'agent', agentId, book1.id, 'read', 'allow');
    expect(await canRead('agent', agentId, ws2Book.id)).toBe(false);
  });
});

describe('G — default deny on no matching grant', () => {
  test('G1: no grants at all', async () => {
    const u = await insertUser('g1');
    expect(await canRead('user', u, page1.id)).toBe(false);
  });

  test('G2: grants exist but only for unrelated resources', async () => {
    const u = await insertUser('g2');
    await grant(ws.workspaceId, 'user', u, book2.id, 'read', 'allow');
    expect(await canRead('user', u, page3.id)).toBe(false);
  });
});

describe('differential check (not counted in the 30): path-derived and CTE-derived ancestors agree', () => {
  test('the id chain read from nodes.path matches the parent_id-walked ancestor chain', async () => {
    // page3's path was written by the trigger from parent_id; splitting it
    // recovers the same ancestor id chain the resolver's own parent_id
    // walk produces, from the leaf up.
    const segments = page3.path.split('/').filter((s) => s.length > 0);
    const pathDerivedAncestors = [...segments].reverse();

    const ancestorRows = await sql<{ id: string }[]>`
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id, 0 AS depth FROM nodes WHERE id = ${page3.id}
        UNION ALL
        SELECT n.id, n.parent_id, a.depth + 1 FROM nodes n JOIN ancestors a ON n.id = a.parent_id
      )
      SELECT id FROM ancestors ORDER BY depth
    `;
    const cteDerivedAncestors = ancestorRows.map((r) => r.id);

    expect(cteDerivedAncestors).toEqual(pathDerivedAncestors);
  });
});

describe('single-query resolution', () => {
  test('exactly one SQL statement is issued per can() resolution, even for a page five levels deep', async () => {
    const u = await insertUser('single-query');
    await grant(ws.workspaceId, 'user', u, ws.id, 'read', 'allow');

    let statementCount = 0;
    const countingSql = postgres(db.url, {
      max: 1,
      debug: () => {
        statementCount += 1;
      },
    });

    // A brand-new connection's first query always includes postgres.js's
    // one-time array-type OID introspection (needed to bind the
    // perm_action[] parameter) — warm the connection up before counting,
    // so this test measures resolveGrants()'s own footprint, not
    // connection setup.
    await countingSql`SELECT 1`;
    statementCount = 0;

    await can(createGrantLookup(countingSql), { subjectType: 'user', subjectId: u, resourceId: page1.id, action: 'read' });
    await countingSql.end({ timeout: 1 });

    expect(statementCount).toBe(1);
  });
});

describe('tenant scope derived from the authenticated subject', () => {
  test('the resolver has no request-supplied workspace_id input to ignore: resolution is keyed only by resourceId', async () => {
    // GrantQuery (packages/core) and ResolveGrantsInput (this module) carry
    // no workspace_id field at all — there is no channel through which a
    // request body's workspace_id could reach the resolver. Demonstrated
    // behaviourally: a grant in workspace W never resolves for a resource
    // in workspace W2, regardless of anything an untrusted caller might
    // claim, because the only workspace that matters is the one the
    // resource itself belongs to.
    const u = await insertUser('tenant-scope');
    await grant(ws.workspaceId, 'user', u, ws.id, 'manage', 'allow');

    expect(await canRead('user', u, ws.id, 'manage')).toBe(true);
    expect(await canRead('user', u, ws2.id, 'manage')).toBe(false);
  });
});
