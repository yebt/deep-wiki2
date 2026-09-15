import { describe, expect, test } from 'bun:test';
import { AiCredentialProviderSchema, SaveAiCredentialRequestSchema } from './ai-credentials-request';

describe('AiCredentialProviderSchema', () => {
  test('accepts exactly the five BYOK providers — local has no credential to save', () => {
    for (const provider of ['anthropic', 'openai', 'google', 'deepseek', 'openrouter']) {
      expect(AiCredentialProviderSchema.safeParse(provider).success).toBe(true);
    }
    expect(AiCredentialProviderSchema.safeParse('local').success).toBe(false);
  });
});

describe('SaveAiCredentialRequestSchema', () => {
  test('parses a provider and a non-empty key', () => {
    const parsed = SaveAiCredentialRequestSchema.parse({ provider: 'anthropic', apiKey: 'sk-live-example' });

    expect(parsed).toEqual({ provider: 'anthropic', apiKey: 'sk-live-example' });
  });

  test('rejects an empty key', () => {
    const result = SaveAiCredentialRequestSchema.safeParse({ provider: 'anthropic', apiKey: '' });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path)).toEqual([['apiKey']]);
  });

  test('rejects an unknown provider', () => {
    expect(SaveAiCredentialRequestSchema.safeParse({ provider: 'mistral', apiKey: 'x' }).success).toBe(false);
  });

  // workspace-ai-credentials spec — "Request-supplied workspace is ignored":
  // the workspace comes from the URL and the session, never from the body.
  test('strips a workspaceId supplied in the body', () => {
    const parsed = SaveAiCredentialRequestSchema.parse({ provider: 'openai', apiKey: 'x', workspaceId: 'ws-evil' });

    expect(parsed).not.toHaveProperty('workspaceId');
  });
});
