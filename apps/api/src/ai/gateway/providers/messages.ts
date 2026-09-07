/**
 * Converts a `ChatRequest` (design.md — "The provider abstraction") into
 * the `{ system, messages }` shape every adapter in this directory feeds
 * to the Vercel AI SDK's `generateText`/`streamText`. `prefix.cacheBoundary`
 * (`packages/core/src/ai/prefix.ts`) is where the assembled prefix splits
 * from stable (tools, system text, team rule packs — goes to `system`) to
 * volatile (the document and question tail — becomes the first user
 * turn); `request.volatile` is appended after that as further
 * conversation turns.
 */
import type { ChatRequest } from '@deep-wiki/core';

export interface AiMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AiPrompt {
  readonly system: string;
  readonly messages: readonly AiMessage[];
}

export function toAiPrompt(request: ChatRequest): AiPrompt {
  const system = request.prefix.text.slice(0, request.prefix.cacheBoundary);
  const volatileTail = request.prefix.text.slice(request.prefix.cacheBoundary);

  const messages: AiMessage[] = [{ role: 'user', content: volatileTail || ' ' }];
  for (const part of request.volatile) {
    messages.push({ role: part.role, content: part.text });
  }

  return { system, messages };
}
