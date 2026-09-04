/**
 * Invitation lifecycle (invitations spec): create, look up, and accept.
 * Acceptance finds-or-creates the invited user and applies the starting
 * grants directly to `permissions` — there is no separate "workspace
 * membership" table in this schema, so holding a grant in a workspace is
 * what membership means.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { PasswordHasher } from '@deep-wiki/core';
import type postgres from 'postgres';
import { insertGrants } from '../permissions/grants';
import type { StartingGrant } from '../schema';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreateInvitationInput {
  readonly workspaceId: string;
  readonly email: string;
  readonly startingGrants: readonly StartingGrant[];
  readonly ttlDays: number;
  readonly invitedByUserId?: string;
}

export interface CreatedInvitation {
  readonly invitationId: string;
  readonly token: string;
}

export async function createInvitation(sql: postgres.Sql, input: CreateInvitationInput): Promise<CreatedInvitation> {
  const token = generateToken();
  const tokenHash = hashToken(token);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO invitations (workspace_id, email, token_hash, starting_grants, invited_by_user_id, expires_at)
    VALUES (
      ${input.workspaceId},
      ${input.email},
      ${tokenHash},
      ${sql.json([...input.startingGrants] as unknown as postgres.JSONValue)},
      ${input.invitedByUserId ?? null},
      now() + (${input.ttlDays}::int * interval '1 day')
    )
    RETURNING id
  `;

  return { invitationId: row!.id, token };
}

export interface InvitationRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly email: string;
  readonly startingGrants: readonly StartingGrant[];
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
}

interface InvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  starting_grants: StartingGrant[];
  expires_at: Date;
  accepted_at: Date | null;
}

export async function findInvitationByToken(sql: postgres.Sql, token: string): Promise<InvitationRecord | null> {
  const tokenHash = hashToken(token);

  const [row] = await sql<InvitationRow[]>`
    SELECT id, workspace_id, email, starting_grants, expires_at, accepted_at
      FROM invitations
     WHERE token_hash = ${tokenHash}
  `;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    workspaceId: row.workspace_id,
    email: row.email,
    startingGrants: row.starting_grants,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
  };
}

export interface AcceptInvitationInput {
  readonly password: string;
  readonly displayName: string;
}

export type AcceptInvitationResult =
  | { readonly outcome: 'ok'; readonly userId: string; readonly workspaceId: string }
  | { readonly outcome: 'invalid' | 'expired' | 'already-accepted' };

/**
 * Accepts an invitation: finds or creates the invited user, applies the
 * starting grants to `permissions`, and marks the invitation accepted —
 * all inside one transaction, so a crash midway never leaves a partially
 * applied invitation.
 */
export async function acceptInvitation(
  sql: postgres.Sql,
  token: string,
  input: AcceptInvitationInput,
  passwordHasher: PasswordHasher,
): Promise<AcceptInvitationResult> {
  const tokenHash = hashToken(token);

  return sql.begin(async (tx) => {
    const [invitation] = await tx<InvitationRow[]>`
      SELECT id, workspace_id, email, starting_grants, expires_at, accepted_at
        FROM invitations
       WHERE token_hash = ${tokenHash}
       FOR UPDATE
    `;

    if (!invitation) {
      return { outcome: 'invalid' };
    }
    if (invitation.accepted_at) {
      return { outcome: 'already-accepted' };
    }
    if (invitation.expires_at.getTime() <= Date.now()) {
      return { outcome: 'expired' };
    }

    const [existingUser] = await tx<{ id: string }[]>`SELECT id FROM users WHERE email = ${invitation.email}`;
    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const passwordHash = await passwordHasher.hash(input.password);
      const [created] = await tx<{ id: string }[]>`
        INSERT INTO users (email, password_hash, display_name)
        VALUES (${invitation.email}, ${passwordHash}, ${input.displayName})
        RETURNING id
      `;
      userId = created!.id;
    }

    await insertGrants(tx, invitation.workspace_id, 'user', userId, invitation.starting_grants);

    await tx`UPDATE invitations SET accepted_at = now() WHERE id = ${invitation.id}`;

    return { outcome: 'ok', userId, workspaceId: invitation.workspace_id };
  });
}

// Re-exported so callers can check the shape of stored grants without a
// separate import from `../schema`.
export type { StartingGrant };
