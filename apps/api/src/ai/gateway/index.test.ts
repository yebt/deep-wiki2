/**
 * The gateway's 8-step call path (design.md — "Cost enforcement, in the
 * same path that builds the call"). Uses the real `PostgresUsageLedger`
 * and the real `AesGcmCredentialCipher`/repository against a disposable
 * Postgres — only the `ChatModelPort` is fake — so "admission before any
 * client" and "decryption after admission" are proven against real
 * admission state, not a mock that could silently drift from it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { err, ok, Secret, type ChatModelPort, type ChatResult, type ChatStream, type CredentialCipher, type ProviderId, type Result } from '@deep-wiki/core';
import { createPostgresUsageLedger } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { AesGcmCredentialCipher } from '../../adapters/ai/cipher/aes-gcm-cipher';
import { EnvKeyProvider } from '../../adapters/ai/key-provider/env-key-provider';
import { openCredential, saveCredential } from '../../adapters/ai/credentials/repository';
import { generate, stream, type GatewayChatRequest, type GatewayDeps } from './index';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
let cipher: CredentialCipher;

const TEST_KEY_ID = 'k1';
const TEST_KEK = Buffer.alloc(32, 9);
const NOW = '2026-01-01T00:00:00.000Z';
const PERIOD_START = '2026-01-01';

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
  cipher = new AesGcmCredentialCipher(new EnvKeyProvider(new Map([[TEST_KEY_ID, TEST_KEK]]), TEST_KEY_ID));
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedWorkspace(limitMicroUsd: string): Promise<string> {
  const [plan] = await sql<{ id: string }[]>`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly, max_ai_cost_micro_usd_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000000', ${limitMicroUsd})
    RETURNING id
  `;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id})
    RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`})
    RETURNING id
  `;
  return workspace!.id as string;
}

class RecordingChatModel implements ChatModelPort {
  calls = 0;
  streamCalls = 0;
  constructor(
    private readonly generateResult: Result<ChatResult, { code: 'unknown'; message: string }> = ok({
      text: 'hi',
      usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 },
      finishReason: 'stop',
    }),
  ) {}

  async generate() {
    this.calls += 1;
    return this.generateResult as Result<ChatResult, { readonly code: 'rate-limit' | 'auth' | 'network' | 'unknown'; readonly message: string }>;
  }

  async stream(): Promise<Result<ChatStream, { readonly code: 'rate-limit' | 'auth' | 'network' | 'unknown'; readonly message: string }>> {
    this.streamCalls += 1;
    let resolveUsage!: (u: ChatResult['usage']) => void;
    const usage = new Promise<ChatResult['usage']>((resolve) => {
      resolveUsage = resolve;
    });
    (this as unknown as { resolveUsage: typeof resolveUsage }).resolveUsage = resolveUsage;
    return ok({ chunks: (async function* () {})(), usage });
  }
}

function baseRequest(workspaceId: string, overrides: Partial<GatewayChatRequest> = {}): GatewayChatRequest {
  return {
    workspaceId,
    subjectType: 'user',
    subjectId: crypto.randomUUID(),
    rawModelId: 'anthropic:claude-3-5-sonnet-20241022',
    prefixInput: { tools: [], system: 'sys', teamRulePacks: [], document: 'doc', question: 'q' },
    volatile: [],
    maxOutputTokens: 100,
    nowIso: NOW,
    periodStart: PERIOD_START,
    ...overrides,
  };
}

async function buildDeps(chatModel: ChatModelPort, workspaceId: string): Promise<GatewayDeps> {
  await saveCredential(sql, cipher, {
    workspaceId,
    provider: 'anthropic',
    apiKey: new Secret('sk-fake-key'),
    lastFour: 'fake'.slice(-4),
    validatedAt: NOW,
  });

  return {
    ledger: createPostgresUsageLedger(sql),
    openCredential: (ws: string, provider: ProviderId) => openCredential(sql, cipher, ws, provider),
    resolveChatModel: () => chatModel,
    reservationTtlSeconds: 900,
  };
}

describe('generate — admission before any provider client', () => {
  test('an over-budget workspace is refused and the fake provider is never called', async () => {
    const workspaceId = await seedWorkspace('1'); // effectively zero budget for any real call
    const chatModel = new RecordingChatModel();
    const deps = await buildDeps(chatModel, workspaceId);

    const result = await generate(deps, baseRequest(workspaceId));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('over-budget');
    }
    expect(chatModel.calls).toBe(0);
  });

  test('an unregistered model is refused before a client is constructed', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const chatModel = new RecordingChatModel();
    const deps = await buildDeps(chatModel, workspaceId);

    const result = await generate(deps, baseRequest(workspaceId, { rawModelId: 'anthropic:no-such-model' }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('unknown-model');
    }
    expect(chatModel.calls).toBe(0);

    const rows = await sql`SELECT id FROM ai_usage_events WHERE workspace_id = ${workspaceId}`;
    expect(rows).toHaveLength(0);
  });

  test('decryption happens only after admission succeeds, never before', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const chatModel = new RecordingChatModel();

    const order: string[] = [];
    await saveCredential(sql, cipher, {
      workspaceId,
      provider: 'anthropic',
      apiKey: new Secret('sk-fake-key'),
      lastFour: 'fake'.slice(-4),
      validatedAt: NOW,
    });
    const ledger = createPostgresUsageLedger(sql);
    const deps: GatewayDeps = {
      ledger: {
        admit: async (input) => {
          order.push('admit');
          return ledger.admit(input);
        },
        settle: (id, usage) => ledger.settle(id, usage),
        void: (id, reason) => ledger.void(id, reason),
      },
      openCredential: async (ws, provider) => {
        order.push('open-credential');
        return openCredential(sql, cipher, ws, provider);
      },
      resolveChatModel: () => chatModel,
      reservationTtlSeconds: 900,
    };

    const result = await generate(deps, baseRequest(workspaceId));

    expect(result.ok).toBe(true);
    expect(order).toEqual(['admit', 'open-credential']);
  });

  test('a successful call settles the reservation with the provider-reported usage', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const chatModel = new RecordingChatModel();
    const deps = await buildDeps(chatModel, workspaceId);

    const result = await generate(deps, baseRequest(workspaceId));

    expect(result.ok).toBe(true);
    expect(chatModel.calls).toBe(1);
    const [row] = await sql<{ state: string; actual_micro_usd: number }[]>`
      SELECT state, actual_micro_usd FROM ai_usage_events WHERE workspace_id = ${workspaceId}
    `;
    expect(row!.state).toBe('settled');
    expect(Number(row!.actual_micro_usd)).toBeGreaterThan(0);
  });

  test('a provider error voids the reservation rather than settling it', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const chatModel = new RecordingChatModel(err({ code: 'unknown', message: 'boom' }));
    const deps = await buildDeps(chatModel, workspaceId);

    const result = await generate(deps, baseRequest(workspaceId));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('provider-error');
    }
    const [row] = await sql<{ state: string }[]>`SELECT state FROM ai_usage_events WHERE workspace_id = ${workspaceId}`;
    expect(row!.state).toBe('voided');
  });
});

describe('stream — abort voids the reservation immediately', () => {
  test('an aborted stream leaves no live reservation', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const chatModel = new RecordingChatModel();
    const deps = await buildDeps(chatModel, workspaceId);
    const controller = new AbortController();

    const result = await stream(deps, baseRequest(workspaceId), controller.signal);
    expect(result.ok).toBe(true);

    controller.abort();
    // The abort listener's `ledger.void` call is fire-and-forget; give the
    // microtask queue one turn to let it land.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const [row] = await sql<{ state: string }[]>`SELECT state FROM ai_usage_events WHERE workspace_id = ${workspaceId}`;
    expect(row!.state).toBe('voided');

    const [period] = await sql<{ reserved_micro_usd: number }[]>`
      SELECT reserved_micro_usd FROM workspace_ai_budget_periods WHERE workspace_id = ${workspaceId} AND period_start = ${PERIOD_START}
    `;
    expect(Number(period!.reserved_micro_usd)).toBe(0);
  });
});
