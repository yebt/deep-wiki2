/**
 * `toAiPrompt` is where the stable prefix (`packages/core/src/ai/prefix.ts`)
 * becomes the SDK's `{ system, messages }`. The split point is
 * `cacheBoundary`: everything before it is the cacheable `system`,
 * everything after it opens the conversation, and the volatile turns
 * follow in order.
 */
import { describe, expect, test } from 'bun:test';
import type { ChatRequest } from '@deep-wiki/core';
import { toAiPrompt } from './messages';

function request(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: { provider: 'anthropic', slug: 'claude-3-5-sonnet-20241022' },
    prefix: { text: 'STABLE|volatile tail', hash: 'h', cacheBoundary: 7 },
    volatile: [],
    maxOutputTokens: 100,
    ...overrides,
  };
}

describe('toAiPrompt', () => {
  test('splits the prefix at cacheBoundary: stable half is system, the rest opens the conversation', () => {
    const prompt = toAiPrompt(request());

    expect(prompt.system).toBe('STABLE|');
    expect(prompt.messages).toEqual([{ role: 'user', content: 'volatile tail' }]);
  });

  test('volatile parts follow the opening turn in order, with their roles', () => {
    const prompt = toAiPrompt(
      request({
        volatile: [
          { role: 'assistant', text: 'first reply' },
          { role: 'user', text: 'follow-up' },
        ],
      }),
    );

    expect(prompt.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(prompt.messages[1]).toEqual({ role: 'assistant', content: 'first reply' });
    expect(prompt.messages[2]).toEqual({ role: 'user', content: 'follow-up' });
  });

  test('an empty volatile tail still yields a non-empty opening user turn', () => {
    const prompt = toAiPrompt(request({ prefix: { text: 'all stable', hash: 'h', cacheBoundary: 10 } }));

    expect(prompt.system).toBe('all stable');
    expect(prompt.messages[0]?.content.length).toBeGreaterThan(0);
  });
});
