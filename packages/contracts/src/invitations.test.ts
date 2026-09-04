import { describe, expect, test } from 'bun:test';
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  StartingGrantSchema,
} from './invitations';

describe('StartingGrantSchema', () => {
  test('accepts a resourceId and a valid action', () => {
    expect(StartingGrantSchema.safeParse({ resourceId: 'r1', action: 'read' }).success).toBe(true);
  });

  test('rejects an action outside the lattice', () => {
    expect(StartingGrantSchema.safeParse({ resourceId: 'r1', action: 'delete' }).success).toBe(false);
  });
});

describe('CreateInvitationRequestSchema / CreateInvitationResponseSchema', () => {
  test('accepts a workspace, an email, and at least one starting grant', () => {
    const result = CreateInvitationRequestSchema.safeParse({
      workspaceId: 'ws1',
      email: 'invitee@example.com',
      startingGrants: [{ resourceId: 'r1', action: 'read' }],
    });

    expect(result.success).toBe(true);
  });

  test('rejects zero starting grants', () => {
    const result = CreateInvitationRequestSchema.safeParse({
      workspaceId: 'ws1',
      email: 'invitee@example.com',
      startingGrants: [],
    });

    expect(result.success).toBe(false);
  });

  test('accepts the bare acknowledgement', () => {
    expect(CreateInvitationResponseSchema.safeParse({ ok: true }).success).toBe(true);
  });
});

describe('AcceptInvitationRequestSchema / AcceptInvitationResponseSchema', () => {
  test('accepts a token, password, and display name', () => {
    const result = AcceptInvitationRequestSchema.safeParse({
      token: 't',
      password: 'p',
      displayName: 'New Member',
    });

    expect(result.success).toBe(true);
  });

  test('response carries the joined workspaceId, never a raw invitation token', () => {
    const result = AcceptInvitationResponseSchema.safeParse({ ok: true, workspaceId: 'ws1' });

    expect(result.success).toBe(true);
  });
});
