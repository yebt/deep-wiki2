/**
 * OpenAI adapter (ai-provider-registry spec). Uses the classic Chat
 * Completions surface (`.chat(modelId)`) rather than the Responses API
 * default this SDK version otherwise selects — the same wire idiom
 * DeepSeek and OpenRouter's OpenAI-compatible APIs speak, which keeps
 * `messages.ts`'s `{ system, messages }` shape usable across all three.
 */
import { createOpenAI } from '@ai-sdk/openai';
import { embedMany, generateText, streamText } from 'ai';
import {
  err,
  ok,
  type ChatModelPort,
  type ChatRequest,
  type ChatResult,
  type ChatStream,
  type EmbedRequest,
  type EmbedResult,
  type EmbeddingModelPort,
  type ProviderError,
  type Result,
  type Secret,
} from '@deep-wiki/core';
import { mapProviderError } from './errors';
import { mapFinishReason } from './finish-reason';
import { toAiPrompt } from './messages';

export class OpenAiChatModel implements ChatModelPort, EmbeddingModelPort {
  constructor(private readonly fetchImpl?: typeof fetch) {}

  async generate(request: ChatRequest, key: Secret<string>): Promise<Result<ChatResult, ProviderError>> {
    const provider = createOpenAI({ apiKey: key.reveal(), fetch: this.fetchImpl });
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
    const provider = createOpenAI({ apiKey: key.reveal(), fetch: this.fetchImpl });
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

  async embed(request: EmbedRequest, key: Secret<string>): Promise<Result<EmbedResult, ProviderError>> {
    const provider = createOpenAI({ apiKey: key.reveal(), fetch: this.fetchImpl });

    try {
      const result = await embedMany({ model: provider.embedding(request.model.slug), values: [...request.input], maxRetries: 0 });

      return ok({
        embeddings: result.embeddings,
        usage: { inputTokens: result.usage.tokens ?? 0 },
      });
    } catch (caught) {
      return err(mapProviderError(caught));
    }
  }
}
