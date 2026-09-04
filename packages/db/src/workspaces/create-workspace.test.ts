import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { createWorkspace, PlanLimitExceededError } from './create-workspace';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 1 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedUserWithPlan(maxWorkspaces: number) {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, ${maxWorkspaces}, 5, '1000000', '1000')
    RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id})
    RETURNING id
  `;
  return user!.id as string;
}

describe('createWorkspace — plan limits bound workspace creation (D12)', () => {
  test('creation within the plan limit succeeds and creates a workspace root node', async () => {
    const ownerId = await seedUserWithPlan(3);
    await createWorkspace(sql, { ownerId, name: 'Acme', slug: `acme-${crypto.randomUUID()}` });
    await createWorkspace(sql, { ownerId, name: 'Acme 2', slug: `acme-2-${crypto.randomUUID()}` });

    const result = await createWorkspace(sql, { ownerId, name: 'Acme 3', slug: `acme-3-${crypto.randomUUID()}` });

    expect(result.workspaceId).toBeTruthy();
    expect(result.rootNodeId).toBeTruthy();

    const [root] = await sql`SELECT type, parent_id FROM nodes WHERE id = ${result.rootNodeId}`;
    expect(root!.type).toBe('workspace');
    expect(root!.parent_id).toBeNull();
  });

  test('creation at the plan limit is refused, naming the plan limit', async () => {
    const ownerId = await seedUserWithPlan(1);
    await createWorkspace(sql, { ownerId, name: 'Acme', slug: `acme-${crypto.randomUUID()}` });

    let error: unknown;
    try {
      await createWorkspace(sql, { ownerId, name: 'Acme 2', slug: `acme-2-${crypto.randomUUID()}` });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(PlanLimitExceededError);
    expect((error as Error).message).toContain('1');

    const count = await sql`SELECT id FROM workspaces WHERE owner_id = ${ownerId}`;
    expect(count).toHaveLength(1);
  });

  test('concurrent creations at the limit boundary serialise instead of both succeeding', async () => {
    const ownerId = await seedUserWithPlan(1);

    const results = await Promise.allSettled([
      createWorkspace(sql, { ownerId, name: 'A', slug: `race-a-${crypto.randomUUID()}` }),
      createWorkspace(sql, { ownerId, name: 'B', slug: `race-b-${crypto.randomUUID()}` }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const count = await sql`SELECT id FROM workspaces WHERE owner_id = ${ownerId}`;
    expect(count).toHaveLength(1);
  });
});
