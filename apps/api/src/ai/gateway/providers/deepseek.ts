/**
 * DeepSeek adapter (ai-provider-registry spec — "DeepSeek MUST be
 * integrated through an OpenAI-compatible adapter"). No embeddings: both
 * vendor documentation and the registry (`packages/core/src/ai/registry.ts`)
 * agree DeepSeek has no first-party embeddings endpoint.
 */
import { createDeepSeek } from '@ai-sdk/deepseek';
import { generateText, streamText } from 'ai';
import { err, ok, type ChatModelPort, type ChatRequest, type ChatResult, type ChatStream, type ProviderError, type Result, type Secret } from '@deep-wiki/core';
import { mapProviderError } from './errors';
import { mapFinishReason } from './finish-reason';
import { toAiPrompt } from './messages';

export class DeepSeekChatModel implements ChatModelPort {
  constructor(private readonly fetchImpl?: typeof fetch) {}

  async generate(request: ChatRequest, key: Secret<string>): Promise<Result<ChatResult, ProviderError>> {
    const provider = createDeepSeek({ apiKey: key.reveal(), fetch: this.fetchImpl });
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
    const provider = createDeepSeek({ apiKey: key.reveal(), fetch: this.fetchImpl });
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
