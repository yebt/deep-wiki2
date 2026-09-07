/**
 * OpenRouter adapter (ai-provider-registry spec — "OpenRouter MUST serve
 * as the catch-all for models not natively wired"). Its capabilities are
 * the proxied route's own (design.md D13) — this adapter never inherits
 * a native provider's caching or capability assumptions. No embeddings:
 * the registry does not offer OpenRouter as an `embedding_provider`
 * (Phase 15.10) until a probe confirms one.
 */
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText, streamText } from 'ai';
import { err, ok, type ChatModelPort, type ChatRequest, type ChatResult, type ChatStream, type ProviderError, type Result, type Secret } from '@deep-wiki/core';
import { mapProviderError } from './errors';
import { mapFinishReason } from './finish-reason';
import { toAiPrompt } from './messages';

export class OpenRouterChatModel implements ChatModelPort {
  constructor(private readonly fetchImpl?: typeof fetch) {}

  async generate(request: ChatRequest, key: Secret<string>): Promise<Result<ChatResult, ProviderError>> {
    const provider = createOpenRouter({ apiKey: key.reveal(), fetch: this.fetchImpl });
    const { system, messages } = toAiPrompt(request);

    try {
      const result = await generateText({
        model: provider.chat(request.model.slug),
        system,
        messages: [...messages],
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: 0,
      });

      return ok({
        text: result.text,
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          cachedInputTokens: result.usage.inputTokenDetails?.cacheReadTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
        finishReason: mapFinishReason(result.finishReason),
      });
    } catch (caught) {
      return err(mapProviderError(caught));
    }
  }

  async stream(request: ChatRequest, key: Secret<string>): Promise<Result<ChatStream, ProviderError>> {
    const provider = createOpenRouter({ apiKey: key.reveal(), fetch: this.fetchImpl });
    const { system, messages } = toAiPrompt(request);

    try {
      const result = streamText({
        model: provider.chat(request.model.slug),
        system,
        messages: [...messages],
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: 0,
      });

      return ok({
        chunks: result.textStream,
        usage: Promise.resolve(result.usage).then((usage) => ({
          inputTokens: usage.inputTokens ?? 0,
          cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
        })),
      });
    } catch (caught) {
      return err(mapProviderError(caught));
    }
  }
}
