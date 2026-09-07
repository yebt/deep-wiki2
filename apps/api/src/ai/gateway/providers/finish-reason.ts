/**
 * Maps the Vercel AI SDK's `FinishReason` onto our closed
 * `ChatFinishReason` (`packages/core/src/ai/ports.ts`). Every value maps
 * 1:1 except `'other'`, which the SDK itself documents as a catch-all —
 * folded to `'error'` rather than adding a sixth, SDK-shaped rung to a
 * port that must stay free of any SDK-specific vocabulary.
 */
import type { FinishReason as AiFinishReason } from 'ai';
import type { ChatFinishReason } from '@deep-wiki/core';

export function mapFinishReason(reason: AiFinishReason): ChatFinishReason {
  if (reason === 'other') {
    return 'error';
  }
  return reason;
}
