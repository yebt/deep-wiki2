/**
 * The second of GATE-1's two independent proofs (design.md — "Two proofs,
 * because correctness and cost fail differently"): correctness is
 * truth-table.test.ts; this file proves the resolver's query plan never
 * degrades to a sequential scan, under a fixture large enough (~20k
 * `nodes`, ~60k `permissions`) that a sequential scan is genuinely the
 * wrong plan — a small fixture would make a seq scan the *correct* plan,
 * so the assertion would prove nothing (D16). `enable_seqscan` is
 * asserted still `on`: forcing the planner off would make this
 * tautological.
 *
 * The WITH RECURSIVE text below is a deliberate, faithful copy of
 * `resolver.ts`'s query so `EXPLAIN` can be prefixed onto it — any change
 * to that query's shape must be mirrored here.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

const WORKSPACE_COUNT = 4000; // x5 nodes per workspace = 20,000 nodes
const SUBJECTS_PER_NODE = 3; // x20,000 nodes = 60,000 permissions rows

let targetWorkspaceRootId: string;
let targetPageId: string;
let targetSubjectId: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });

  const [plan] = await sql<{ id: string }[]>`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`explain-plan-${crypto.randomUUID()}`}, 999999, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`explain-owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;

  await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    SELECT ${user!.id}, 'explain-ws-' || gs, 'explain-ws-' || gs || '-' || gen_random_uuid()
      FROM generate_series(1, ${WORKSPACE_COUNT}) AS gs
  `;

  // Breadth-first bulk population, one INSERT ... SELECT per level — the
  // trigger still fires once per resulting row, but this is a handful of
  // round trips instead of 20,000.
  await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    SELECT id, NULL, 'workspace', '', 0, 'root', 'root' FROM workspaces WHERE owner_id = ${user!.id}
  `;
  await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    SELECT workspace_id, id, 'shelf', '', 0, 'shelf', 'shelf' FROM nodes WHERE type = 'workspace'
  `;
  await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    SELECT workspace_id, id, 'book', '', 0, 'book', 'book' FROM nodes WHERE type = 'shelf'
  `;
  await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    SELECT workspace_id, id, 'chapter', '', 0, 'chapter', 'chapter' FROM nodes WHERE type = 'book'
  `;
  await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    SELECT workspace_id, id, 'page', '', 0, 'page', 'page' FROM nodes WHERE type = 'chapter'
  `;

  const subjectIds = Array.from({ length: SUBJECTS_PER_NODE }, () => crypto.randomUUID());
  targetSubjectId = subjectIds[0]!;

  for (const subjectId of subjectIds) {
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      SELECT workspace_id, 'user'::subject_kind, ${subjectId}::uuid, id, 'read'::perm_action, 'allow'::perm_effect
        FROM nodes
    `;
  }

  await sql`ANALYZE nodes`;
  await sql`ANALYZE permissions`;
  await sql`ANALYZE cell_members`;

  const [root] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE type = 'workspace' LIMIT 1`;
  targetWorkspaceRootId = root!.id;
  const [page] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE type = 'page' AND workspace_id = ${(await sql<{ workspace_id: string }[]>`SELECT workspace_id FROM nodes WHERE id = ${targetWorkspaceRootId}`)[0]!.workspace_id}`;
  targetPageId = page!.id;
}, 60_000);

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
}, 30_000);

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

function collectPlanNodes(node: PlanNode, into: PlanNode[] = []): PlanNode[] {
  into.push(node);
  for (const child of node.Plans ?? []) {
    collectPlanNodes(child, into);
  }
  return into;
}

/**
 * Postgres's JSON EXPLAIN(BUFFERS) reports each node's Shared Hit/Read
 * Blocks CUMULATIVELY (already including its subtree) — verified directly
 * against this Postgres by comparing every node's own count against its
 * children's. Summing across every flattened node therefore massively
 * over-counts; the root node's own count already IS the query's total.
 */
function totalSharedBlocks(root: PlanNode): number {
  return (root['Shared Hit Blocks'] ?? 0) + (root['Shared Read Blocks'] ?? 0);
}

async function explainResolverQuery(resourceId: string): Promise<PlanNode> {
  const allowActions = ['read', 'comment', 'write', 'manage'];
  const denyActions = ['read'];

  const [row] = await sql<{ 'QUERY PLAN': [{ Plan: PlanNode }] }[]>`
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    WITH RECURSIVE ancestors AS (
        SELECT n.id, n.workspace_id, n.parent_id, 0 AS depth
          FROM nodes n
         WHERE n.id = ${resourceId}
        UNION ALL
        SELECT p.id, p.workspace_id, p.parent_id, a.depth + 1
          FROM nodes p
          JOIN ancestors a ON p.id = a.parent_id
         WHERE p.workspace_id = a.workspace_id
    ),
    subjects AS (
        SELECT 'user'::subject_kind AS subject_type, ${targetSubjectId}::uuid AS subject_id
        UNION ALL
        SELECT 'cell'::subject_kind, cm.cell_id
          FROM cell_members cm
         WHERE 'user'::subject_kind = 'user'
           AND cm.user_id = ${targetSubjectId}::uuid
           AND cm.workspace_id = (SELECT workspace_id FROM nodes WHERE id = ${resourceId})
    )
    SELECT DISTINCT p.effect, a.depth
      FROM permissions p
      JOIN ancestors a ON a.id = p.resource_id
                      AND a.workspace_id = p.workspace_id
      JOIN subjects  s ON s.subject_type = p.subject_type
                      AND s.subject_id   = p.subject_id
     WHERE (p.effect = 'allow' AND p.action = ANY(${allowActions}::perm_action[]))
        OR (p.effect = 'deny'  AND p.action = ANY(${denyActions}::perm_action[]))
  `;

  return row!['QUERY PLAN'][0].Plan;
}

describe('resolver query plan (GATE-1, cost proof)', () => {
  test('enable_seqscan is still on (D16) — forcing the planner would make this assertion tautological', async () => {
    const [row] = await sql<{ enable_seqscan: string }[]>`SHOW enable_seqscan`;
    expect(row!.enable_seqscan).toBe('on');
  });

  test('a depth-0 resolution (workspace root) never sequentially scans nodes or permissions', async () => {
    const root = await explainResolverQuery(targetWorkspaceRootId);
    const nodes = collectPlanNodes(root);
    const seqScans = nodes.filter((n) => n['Node Type'] === 'Seq Scan' && (n['Relation Name'] === 'nodes' || n['Relation Name'] === 'permissions'));
    expect(seqScans).toEqual([]);
  });

  test('a depth-4 resolution (a page five levels deep) never sequentially scans nodes or permissions', async () => {
    const root = await explainResolverQuery(targetPageId);
    const nodes = collectPlanNodes(root);
    const seqScans = nodes.filter((n) => n['Node Type'] === 'Seq Scan' && (n['Relation Name'] === 'nodes' || n['Relation Name'] === 'permissions'));
    expect(seqScans).toEqual([]);
  });

  test('a depth-4 resolution touches fewer than 200 shared buffer blocks in total', async () => {
    const root = await explainResolverQuery(targetPageId);
    expect(totalSharedBlocks(root)).toBeLessThan(200);
  });
});

describe('subtree query plan (4.5, re-confirmed under load)', () => {
  test('the subtree query uses nodes_ws_path_idx, proving text_pattern_ops is sargable under this collation', async () => {
    const [wsRow] = await sql<{ workspace_id: string; path: string }[]>`
      SELECT workspace_id, path FROM nodes WHERE id = ${targetWorkspaceRootId}
    `;

    const [row] = await sql<{ 'QUERY PLAN': [{ Plan: PlanNode }] }[]>`
      EXPLAIN (FORMAT JSON)
      SELECT id FROM nodes WHERE workspace_id = ${wsRow!.workspace_id} AND path LIKE ${`${wsRow!.path}%`}
    `;

    const nodes = collectPlanNodes(row!['QUERY PLAN'][0].Plan);
    const seqScans = nodes.filter((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'nodes');
    expect(seqScans).toEqual([]);
    expect(nodes.some((n) => n['Index Name'] === 'nodes_ws_path_idx')).toBe(true);
  });
});
