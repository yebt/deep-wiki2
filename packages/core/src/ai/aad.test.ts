import { describe, expect, test } from 'bun:test';
import { buildAad } from './aad';

describe('buildAad', () => {
  test('is deterministic for the same input', () => {
    const a = buildAad({ workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' });
    const b = buildAad({ workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' });

    expect(a).toEqual(b);
  });

  test('is sensitive to field boundaries, not merely to concatenated content', () => {
    // Naive concatenation would make these collide ('ab'+'c' === 'a'+'bc');
    // the AAD must not.
    const a = buildAad({ workspaceId: 'ab', credentialId: 'c', provider: 'anthropic' });
    const b = buildAad({ workspaceId: 'a', credentialId: 'bc', provider: 'anthropic' });

    expect(a).not.toEqual(b);
  });

  test('is sensitive to field order — swapping workspaceId and credentialId changes the result', () => {
    const a = buildAad({ workspaceId: 'ws1', credentialId: 'ws2', provider: 'anthropic' });
    const b = buildAad({ workspaceId: 'ws2', credentialId: 'ws1', provider: 'anthropic' });

    expect(a).not.toEqual(b);
  });

  test('two different workspaces produce different AAD for the same credential id and provider', () => {
    const a = buildAad({ workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' });
    const b = buildAad({ workspaceId: 'ws2', credentialId: 'cred1', provider: 'anthropic' });

    expect(a).not.toEqual(b);
  });

  test('returns raw bytes, not a string', () => {
    const a = buildAad({ workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' });

    expect(a).toBeInstanceOf(Uint8Array);
  });
});
