import { describe, expect, test } from 'bun:test';
import {
  AiCredentialSummarySchema,
  ListAiCredentialsResponseSchema,
  SaveAiCredentialResponseSchema,
} from './ai-credentials';

describe('SaveAiCredentialResponseSchema', () => {
  test('parses the acknowledgement and the four visible characters', () => {
    expect(SaveAiCredentialResponseSchema.parse({ ok: true, lastFour: 'ab12' })).toEqual({ ok: true, lastFour: 'ab12' });
  });

  test('lastFour is exactly four characters — never a longer fragment of the key', () => {
    expect(SaveAiCredentialResponseSchema.safeParse({ ok: true, lastFour: 'abc' }).success).toBe(false);
    expect(SaveAiCredentialResponseSchema.safeParse({ ok: true, lastFour: 'sk-live-example' }).success).toBe(false);
  });

  test('ok is the literal true, not any truthy value', () => {
    expect(SaveAiCredentialResponseSchema.safeParse({ ok: 'yes', lastFour: 'ab12' }).success).toBe(false);
  });
});

describe('AiCredentialSummarySchema', () => {
  test('parses a validated and a never-validated credential', () => {
    expect(
      AiCredentialSummarySchema.parse({ provider: 'openai', lastFour: 'ab12', validatedAt: '2026-09-06T00:00:00.000Z' }).validatedAt,
    ).toBe('2026-09-06T00:00:00.000Z');
    expect(AiCredentialSummarySchema.parse({ provider: 'openai', lastFour: 'ab12', validatedAt: null }).validatedAt).toBeNull();
  });

  // The read side carries no field that could hold key material; a row
  // that leaks one is stripped, so the response stays lastFour-only.
  test('strips any extra field a repository row might carry', () => {
    const parsed = AiCredentialSummarySchema.parse({
      provider: 'openai',
      lastFour: 'ab12',
      validatedAt: null,
      ciphertext: 'never',
    });

    expect(Object.keys(parsed).sort()).toEqual(['lastFour', 'provider', 'validatedAt']);
  });
});

describe('ListAiCredentialsResponseSchema', () => {
  test('parses an empty list and a populated one', () => {
    expect(ListAiCredentialsResponseSchema.parse({ credentials: [] }).credentials).toEqual([]);
    const parsed = ListAiCredentialsResponseSchema.parse({
      credentials: [{ provider: 'google', lastFour: 'zz99', validatedAt: null }],
    });
    expect(parsed.credentials).toHaveLength(1);
  });
});
