import { describe, expect, test } from 'bun:test';
import { err, ok } from '../result';
import { Secret } from '../secret';
import type {
  ChatModelPort,
  CredentialCipher,
  EmbeddingModelPort,
  KeyProvider,
  UsageLedger,
} from './ports';

/**
 * These are compile-time assertions: if any port interface required an
 * SDK-specific type (a Vercel AI SDK `LanguageModelV1`, an OpenRouter
 * response type, anything from `@ai-sdk/*`), a fake implementation built
 * from nothing but `Result`, `Secret`, and JS primitives would fail to
 * type-check — `bun run typecheck` is the real assertion here. The
 * regression guard against a *type-only* leak (invisible to a naive AST
 * import scan) is `core-purity.ts` rule 3 (Phase 1), which runs over this
 * exact file. This test also exercises each fake at runtime so the
 * interfaces are provably callable, not merely syntactically valid.
 */
describe('port interfaces compose only of Result/Secret/primitive types', () => {
  test('a fake ChatModelPort built from primitives satisfies the interface', async () => {
    const fake: ChatModelPort = {
      generate: async () =>
        ok({ text: 'hello', usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 }, finishReason: 'stop' }),
      stream: async () => err({ code: 'unknown', message: 'not implemented' }),
    };

    const result = await fake.generate(
      {
        model: { provider: 'anthropic', slug: 'claude-3-5-sonnet-20241022' },
        prefix: { text: 't', hash: 'h', cacheBoundary: 1 },
        volatile: [{ role: 'user', text: 'hi' }],
        maxOutputTokens: 100,
      },
      new Secret('sk-fake'),
    );

    expect(result.ok).toBe(true);
  });

  test('a fake EmbeddingModelPort built from primitives satisfies the interface', async () => {
    const fake: EmbeddingModelPort = {
      embed: async () => ok({ embeddings: [[0.1, 0.2]], usage: { inputTokens: 3 } }),
    };

    const result = await fake.embed(
      { model: { provider: 'openai', slug: 'text-embedding-3-small' }, input: ['hello'] },
      new Secret('sk-fake'),
    );

    expect(result.ok).toBe(true);
  });

  test('a fake KeyProvider built from primitives satisfies the interface', async () => {
    const fake: KeyProvider = {
      activeKeyId: () => 'k1',
      wrap: async (dek: Uint8Array) => ok(dek),
      unwrap: async (wrapped: Uint8Array) => ok(wrapped),
    };

    expect(fake.activeKeyId()).toBe('k1');
    const wrapped = await fake.wrap(new Uint8Array([1, 2, 3]), 'k1');
    expect(wrapped.ok).toBe(true);
  });

  test('a fake CredentialCipher built from primitives satisfies the interface', async () => {
    const fake: CredentialCipher = {
      seal: async () =>
        ok({
          ciphertext: new Uint8Array([1]),
          iv: new Uint8Array([2]),
          authTag: new Uint8Array([3]),
          wrappedDek: new Uint8Array([4]),
          keyId: 'k1',
        }),
      open: async () => ok(new Secret('plaintext')),
    };

    const aad = { workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' };
    const sealed = await fake.seal(new Secret('plaintext'), aad);
    expect(sealed.ok).toBe(true);
    if (sealed.ok) {
      const opened = await fake.open(sealed.value, aad);
      expect(opened.ok).toBe(true);
    }
  });

  test('a fake UsageLedger built from primitives satisfies the interface', async () => {
    const fake: UsageLedger = {
      admit: async () => ok({ id: 'r1', state: 'reserved', reservedMicroUsd: 100, expiresAt: '2026-01-01T00:15:00.000Z' }),
      settle: async () => ok(undefined),
      void: async () => ok(undefined),
    };

    const admission = await fake.admit({
      workspaceId: 'ws1',
      periodStart: '2026-01-01',
      subjectType: 'user',
      subjectId: 'user1',
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      operation: 'chat',
      reserveMicroUsd: 100,
      nowIso: '2026-01-01T00:00:00.000Z',
      expiresAtIso: '2026-01-01T00:15:00.000Z',
    });
    expect(admission.ok).toBe(true);
    const settled = await fake.settle('r1', { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1 });
    expect(settled.ok).toBe(true);
    const voided = await fake.void('r1', 'aborted');
    expect(voided.ok).toBe(true);
  });
});
