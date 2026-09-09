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

  test('rejects an action outside the lattice, and the action is what it names', () => {
    const result = StartingGrantSchema.safeParse({ resourceId: 'r1', action: 'delete' });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['action']]);
    expect(result.error.issues[0]?.code).toBe('invalid_enum_value');
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
    if (result.success) return;

    // `.min(1)` is the guarantee — an invitation that grants nothing is not
    // an invitation. Without the code, a schema that rejected the whole body
    // for any other reason would pass this test just as well.
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['startingGrants']]);
    expect(result.error.issues[0]?.code).toBe('too_small');
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

  test('response carries the joined workspaceId', () => {
    const parsed = AcceptInvitationResponseSchema.parse({ ok: true, workspaceId: 'ws1' });

    expect(parsed).toEqual({ ok: true, workspaceId: 'ws1' });
  });

  // The old test was called "never a raw invitation token" and asserted only
  // that a body without one parses — which says nothing about a body with
  // one. The schema accepts that input and drops the token; that is the
  // guarantee, so that is what is asserted.
  test('strips a raw invitation token a widened handler might echo back', () => {
    const parsed = AcceptInvitationResponseSchema.parse({
      ok: true,
      workspaceId: 'ws1',
      token: 'the-raw-invitation-token',
    });

    expect(parsed).toEqual({ ok: true, workspaceId: 'ws1' });
  });
});
