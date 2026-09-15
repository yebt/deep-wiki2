/**
 * Anthropic adapter (ai-provider-registry spec — "Provider Abstraction
 * via a Core Port"). `fetch` is accepted by injection so this class is
 * fixture-replayable with no network access, per `design.md`'s testing
 * strategy. `maxRetries: 0` keeps a single injected fixture response
 * deterministic — the SDK's own retry loop would otherwise call `fetch`
 * up to three times against one canned response.
 */
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, streamText } from 'ai';
import { err, ok, type ChatModelPort, type ChatRequest, type ChatResult, type ChatStream, type ProviderError, type Result, type Secret } from '@deep-wiki/core';
import { mapProviderError } from './errors';
import { mapFinishReason } from './finish-reason';
import { toAiPrompt } from './messages';

export class AnthropicChatModel implements ChatModelPort {
  constructor(private readonly fetchImpl?: typeof fetch) {}

  async generate(request: ChatRequest, key: Secret<string>): Promise<Result<ChatResult, ProviderError>> {
    const provider = createAnthropic({ apiKey: key.reveal(), fetch: this.fetchImpl });
    const { system, messages } = toAiPrompt(request);

    try {
      const result = await generateText({
        model: provider(request.model.slug),
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
    const provider = createAnthropic({ apiKey: key.reveal(), fetch: this.fetchImpl });
    const { system, messages } = toAiPrompt(request);

    try {
      const result = streamText({
        model: provider(request.model.slug),
        system,
        messages: [...messages],
        maxOutputTokens: request.maxOutputTokens,
        maxRetries: 0,
      });
      // `streamText` does not fire the request until the stream is first
      // read — a request-level failure (e.g. an invalid credential)
      // therefore surfaces later, through the rejected `usage` promise or
      // a throwing `chunks` iterator, never from this synchronous return.
      // The gateway's own `stream()` wrapper already treats a rejected
      // `usage` as a call to `ledger.void`.

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
