/**
 * Step 6 of the gateway's call path — "resolveChatModel" (design.md —
 * "Cost enforcement, in the same path that builds the call"). The only
 * place a `ProviderId` is turned into a concrete Phase-13 adapter
 * instance; lives inside `apps/api/src/ai/gateway/` because every
 * adapter it references imports the Vercel AI SDK (rule 6).
 *
 * `fetchImpl` is threaded straight through to the adapter constructor —
 * production passes nothing (the SDK's real global `fetch`), a test
 * injects a fixture-backed one.
 */
import type { ChatModelPort, ProviderId } from '@deep-wiki/core';
import { AnthropicChatModel } from './providers/anthropic';
import { DeepSeekChatModel } from './providers/deepseek';
import { GoogleChatModel } from './providers/google';
import { OpenAiChatModel } from './providers/openai';
import { OpenRouterChatModel } from './providers/openrouter';

export function resolveChatModel(provider: ProviderId, fetchImpl?: typeof fetch): ChatModelPort {
  switch (provider) {
    case 'anthropic':
      return new AnthropicChatModel(fetchImpl);
    case 'openai':
      return new OpenAiChatModel(fetchImpl);
    case 'google':
      return new GoogleChatModel(fetchImpl);
    case 'deepseek':
      return new DeepSeekChatModel(fetchImpl);
    case 'openrouter':
      return new OpenRouterChatModel(fetchImpl);
    case 'local':
      // No SDK-backed adapter exists for a local model (design.md — Open
      // Questions, "A 1536-dimension local fallback is unsolved"). Refusing
      // loudly here is the honest answer; the alternative is silently
      // resolving to some other provider's client, which is worse.
      throw new Error('resolveChatModel: no chat model adapter exists for the "local" provider');
  }
}
