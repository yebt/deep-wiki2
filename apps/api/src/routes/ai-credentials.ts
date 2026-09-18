/**
 * Workspace AI credential save/read (workspace-ai-credentials spec;
 * design.md — "Credentials: envelope encryption a self-hoster can
 * operate"). The workspace is resolved from the URL path and the
 * authenticated session — never from the JSON body — so a body carrying
 * a different `workspaceId` has no effect (spec — "Request-supplied
 * workspace is ignored").
 *
 * Authorization goes through the existing `can()` resolver against the
 * workspace's root node, in the exact idiom `invitations.ts` already
 * established, per the spec's "Authorization Through the Existing
 * Resolver" requirement.
 */
import type { CredentialCipher, ProviderId } from '@deep-wiki/core';
import { Secret } from '@deep-wiki/core';
import { ErrorResponseSchema, ListAiCredentialsResponseSchema, SaveAiCredentialRequestSchema, SaveAiCredentialResponseSchema } from '@deep-wiki/contracts';
import { can } from '@deep-wiki/db';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { listCredentialSummaries, saveCredential } from '../adapters/ai/credentials/repository';
import type { CredentialValidationProbe } from '../adapters/ai/credentials/validation-probe';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface AiCredentialRouteDeps {
  readonly sql: postgres.Sql;
  readonly cipher: CredentialCipher;
  readonly validationProbe: CredentialValidationProbe;
  readonly sessionIdleTimeoutMinutes: number;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function lastFourOf(apiKey: string): string {
  return apiKey.slice(-4);
}

/** The failure this maps to a 4xx status — never the raw probe payload (spec — "Validation failure does not leak the key"). */
function probeErrorStatus(): 422 {
  return 422;
}

export function createAiCredentialRoutes(deps: AiCredentialRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const sessionGuard = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  async function resolveWorkspaceRootId(workspaceId: string): Promise<string | undefined> {
    const [root] = await deps.sql<{ id: string }[]>`
      SELECT id FROM live_nodes WHERE workspace_id = ${workspaceId} AND type = 'workspace'
    `;
    return root?.id;
  }

  app.post('/workspaces/:workspaceId/ai-credentials', sessionGuard, async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const rootId = await resolveWorkspaceRootId(workspaceId);
    if (!rootId) {
      return c.json(ErrorResponseSchema.parse({ error: 'workspace not found' }), 404);
    }

    const session = c.get('session');
    const authorized = await can(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
      resourceId: rootId,
      action: 'manage',
    });
    if (!authorized) {
      return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
    }

    const body = await readJsonBody(c.req.raw);
    const parsed = SaveAiCredentialRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(ErrorResponseSchema.parse({ error: 'provider and apiKey are required' }), 400);
    }

    const provider: ProviderId = parsed.data.provider;
    const apiKey = new Secret(parsed.data.apiKey);

    // Validation happens before any encryption or persistence — a
    // provider-rejected key is never sealed and never written
    // (workspace-ai-credentials spec — "Invalid credential is rejected").
    const probeResult = await deps.validationProbe.probe(provider, apiKey);
    if (!probeResult.ok) {
      return c.json(ErrorResponseSchema.parse({ error: `credential validation failed: ${probeResult.errorCode}` }), probeErrorStatus());
    }

    const saved = await saveCredential(deps.sql, deps.cipher, {
      workspaceId,
      provider,
      apiKey,
      lastFour: lastFourOf(parsed.data.apiKey),
      validatedAt: new Date().toISOString(),
    });
    if (!saved.ok) {
      return c.json(ErrorResponseSchema.parse({ error: 'failed to store the credential' }), 500);
    }

    return c.json(SaveAiCredentialResponseSchema.parse({ ok: true, lastFour: saved.value.lastFour }), 201);
  });

  app.get('/workspaces/:workspaceId/ai-credentials', sessionGuard, async (c) => {
    const workspaceId = c.req.param('workspaceId');
    const rootId = await resolveWorkspaceRootId(workspaceId);
    if (!rootId) {
      return c.json(ErrorResponseSchema.parse({ error: 'workspace not found' }), 404);
    }

    const session = c.get('session');
    const authorized = await can(deps.sql, {
      subjectType: 'user',
      subjectId: session.userId,
      resourceId: rootId,
      action: 'read',
    });
    if (!authorized) {
      return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
    }

    const credentials = await listCredentialSummaries(deps.sql, workspaceId);
    return c.json(ListAiCredentialsResponseSchema.parse({ credentials }));
  });

  return app;
}
