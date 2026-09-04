/**
 * Seeds the minimum a person needs to sign in and look around: one plan,
 * one Super Root account, one workspace, and a read grant at the workspace
 * root so the account resolves to `allow` rather than the default deny.
 *
 * Idempotent — safe to re-run. It never overwrites an existing account's
 * password, so a developer who changed theirs does not silently lose it.
 *
 * The seed credentials are development-only and deliberately obvious. The
 * password is read from SEED_PASSWORD when set, so a shared environment can
 * avoid the well-known default without editing this file.
 */
import { createWorkspace, insertGrants } from './src/index';
import postgres from 'postgres';

const SEED_EMAIL = process.env.SEED_EMAIL ?? 'owner@deep-wiki.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'deep-wiki-dev';
const SEED_NAME = 'Seed Owner';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('seed: DATABASE_URL is not set. Copy env.example to .env first.');
    process.exit(1);
  }

  const sql = postgres(url);

  try {
    const [plan] = await sql<{ id: string }[]>`
      INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
           VALUES ('development', 10, 50, '10737418240', '10000000')
      ON CONFLICT (name) DO UPDATE SET updated_at = now()
        RETURNING id
    `;

    const passwordHash = await Bun.password.hash(SEED_PASSWORD, {
      algorithm: 'argon2id',
      memoryCost: 19_456,
      timeCost: 2,
    });

    // DO NOTHING rather than DO UPDATE: re-seeding must not reset a password
    // the developer changed on purpose.
    await sql`
      INSERT INTO users (email, password_hash, display_name, plan_id, is_super_root)
           VALUES (${SEED_EMAIL}, ${passwordHash}, ${SEED_NAME}, ${plan!.id}, true)
      ON CONFLICT (email) DO NOTHING
    `;

    const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${SEED_EMAIL}`;

    const [existing] = await sql<{ id: string; root: string }[]>`
      SELECT w.id, n.id AS root
        FROM workspaces w
        JOIN nodes n ON n.workspace_id = w.id AND n.type = 'workspace'
       WHERE w.slug = 'demo'
    `;

    const workspace = existing
      ? { workspaceId: existing.id, rootNodeId: existing.root }
      : await createWorkspace(sql, { ownerId: user!.id, name: 'Demo workspace', slug: 'demo' });

    await insertGrants(sql, workspace.workspaceId, 'user', user!.id, [
      { resourceId: workspace.rootNodeId, action: 'manage', effect: 'allow' },
    ]);

    console.log('seed: ready');
    console.log(`  sign in at /login with  ${SEED_EMAIL}  /  ${SEED_PASSWORD}`);
    console.log(`  workspace "Demo workspace" (${workspace.workspaceId}), manage granted at its root`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
