/**
 * Bun-only half of e2e/global-setup.ts's backend provisioning.
 *
 * `packages/db/testing/provision.ts` uses `import.meta.dir` (a Bun-only
 * property) at module load time, so it cannot be `import()`ed from
 * Playwright's own (Node) process — attempting it throws immediately
 * ("path argument must be of type string. Received undefined"). This
 * script runs the provisioning/seeding/teardown that module requires as
 * a `bun` child process instead, spawned by global-setup.ts, and talks
 * back over stdout as newline-delimited JSON.
 *
 * Two modes:
 *   bun run e2e/seed.bun.ts          -> provision + migrate + seed, print
 *                                        { url, dbName, ...fixtures }
 *   bun run e2e/seed.bun.ts --drop <dbName> -> drop that database
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { provisionTestDatabase, resolveAdminUrl, dropTestDatabase, defaultProvisionDeps } from '@deep-wiki/db/testing/provision';
import { createInvitation, createPasswordReset } from '@deep-wiki/db';

async function seedFixtures(sql: postgres.Sql) {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-owner-${randomUUID()}@example.com`}, 'unused', 'E2E Owner')
    RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${owner!.id}, 'E2E Workspace', ${`e2e-workspace-${randomUUID()}`})
    RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root')
    RETURNING id
  `;

  const signinEmail = `e2e-signin-${randomUUID()}@example.com`;
  const { token: signinInvitationToken } = await createInvitation(sql, {
    workspaceId: ws!.id,
    email: signinEmail,
    startingGrants: [{ resourceId: root!.id, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: owner!.id,
  });

  // A second, independent account for the keyboard-operability test, so
  // it never shares an in-flight login with the serial sign-in flow above
  // when both run concurrently across Playwright's worker processes.
  const keyboardEmail = `e2e-keyboard-${randomUUID()}@example.com`;
  const { token: keyboardInvitationToken } = await createInvitation(sql, {
    workspaceId: ws!.id,
    email: keyboardEmail,
    startingGrants: [{ resourceId: root!.id, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: owner!.id,
  });

  const expiredInvitationEmail = `e2e-expired-${randomUUID()}@example.com`;
  const { token: expiredInvitationToken } = await createInvitation(sql, {
    workspaceId: ws!.id,
    email: expiredInvitationEmail,
    startingGrants: [{ resourceId: root!.id, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: owner!.id,
  });
  // The token itself is only ever stored hashed, so the just-created row is
  // addressed by its (unique, seed-only) email instead.
  await sql`
    UPDATE invitations SET expires_at = now() - interval '1 minute'
    WHERE email = ${expiredInvitationEmail}
  `;

  // A user who already has a real account (created directly — its
  // password hash is never exercised by any test, only replaced).
  const resetEmail = `e2e-reset-${randomUUID()}@example.com`;
  const [resetUser] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${resetEmail}, 'unused', 'E2E Reset User')
    RETURNING id
  `;
  const { token: resetToken } = await createPasswordReset(sql, resetUser!.id, 30);

  return {
    signinEmail,
    signinInvitationToken,
    keyboardEmail,
    keyboardInvitationToken,
    expiredInvitationToken,
    resetEmail,
    resetToken,
  };
}

async function main(): Promise<void> {
  if (process.argv[2] === '--drop') {
    const name = process.argv[3];
    if (!name) throw new Error('seed.bun.ts --drop requires a database name');
    const adminUrl = await resolveAdminUrl(defaultProvisionDeps);
    await dropTestDatabase(adminUrl, name);
    console.log(`seed.bun.ts: dropped ${name}`);
    return;
  }

  const testDb = await provisionTestDatabase();
  const sql = postgres(testDb.url, { max: 5 });
  try {
    const fixtures = await seedFixtures(sql);
    console.log(JSON.stringify({ url: testDb.url, dbName: testDb.name, ...fixtures }));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
