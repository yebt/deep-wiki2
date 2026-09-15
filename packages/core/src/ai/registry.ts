/**
 * Checked-in per-model capability registry (design.md — "Capability
 * registry and structured-output degradation"). A model with no entry is
 * refused rather than optimistically called (D10). The registry is never
 * written by the runtime — a maintainer edits this file, and drift is
 * surfaced instead of self-healed (D11).
 *
 * Every entry MUST carry `verifiedAt` (an ISO date) and `source`
 * (`'probe' | 'vendor-docs'`) so a claim about a provider's behaviour is
 * attributable evidence, not folklore. `registry.test.ts` asserts this at
 * runtime as well as at the type level.
 *
 * `embeddings` for OpenAI, Google Gemini and OpenRouter is `false` here
 * because their first-party embeddings support is unverified in this
 * session (proposal — "Escalated Open Question"; docs/TODO.md Finding
 * 2026-09-03). Phase 18's `ai:probe` task updates these fields strictly
 * from observed evidence, never from assumption. Anthropic and DeepSeek
 * are `false` because both vendors' documentation was checked directly
 * and neither offers a first-party embeddings endpoint.
 */
import { err, ok, type Result } from '../result';
import type { ModelRef, ProviderId } from './ids';

export type StructuredOutputLevel = 'schema' | 'tool-call' | 'prompted' | 'none';

export interface ModelPricing {
  readonly inputMicroUsdPerMTok: number;
  readonly outputMicroUsdPerMTok: number;
  readonly cachedInputMicroUsdPerMTok: number;
}

export interface ModelCapabilities {
  readonly tools: boolean;
  readonly structuredOutput: StructuredOutputLevel;
  readonly promptCaching: boolean;
  readonly vision: boolean;
  readonly contextWindow: number;
  readonly embeddings: false | { readonly dimensions: readonly number[] };
  readonly pricing: ModelPricing;
  /** ISO date (YYYY-MM-DD) — provenance, not decoration. */
  readonly verifiedAt: string;
  readonly source: 'probe' | 'vendor-docs';
  /** OpenRouter entries only: the proxied model's own identifier. */
  readonly proxiedModel?: string;
}

export interface UnknownModel {
  readonly reason: 'unknown-model';
  readonly ref: ModelRef;
}

function registryKey(provider: ProviderId, slug: string): string {
  return `${provider}:${slug}`;
}

/**
 * Frozen so no caller (including a future gateway) can patch capabilities
 * at runtime — the file, not memory, is the source of truth.
 */
export const MODEL_REGISTRY: Readonly<Record<string, ModelCapabilities>> = Object.freeze({
  [registryKey('anthropic', 'claude-3-5-sonnet-20241022')]: {
    tools: true,
    // Anthropic has no native JSON-schema response format; a single
    // required tool whose parameters are the schema is the strongest
    // guarantee it offers.
    structuredOutput: 'tool-call',
    promptCaching: true,
    vision: true,
    contextWindow: 200_000,
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 3_000_000,
      outputMicroUsdPerMTok: 15_000_000,
      cachedInputMicroUsdPerMTok: 300_000,
    },
    verifiedAt: '2026-09-06',
    source: 'vendor-docs',
  },
  [registryKey('openai', 'gpt-4o')]: {
    tools: true,
    structuredOutput: 'schema',
    promptCaching: true,
    vision: true,
    contextWindow: 128_000,
    // Unverified in this session — see module doc comment.
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 2_500_000,
      outputMicroUsdPerMTok: 10_000_000,
      cachedInputMicroUsdPerMTok: 1_250_000,
    },
    verifiedAt: '2026-09-06',
    source: 'vendor-docs',
  },
  [registryKey('google', 'gemini-1.5-pro')]: {
    tools: true,
    structuredOutput: 'schema',
    promptCaching: true,
    vision: true,
    contextWindow: 2_000_000,
    // Unverified in this session — see module doc comment.
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 1_250_000,
      outputMicroUsdPerMTok: 5_000_000,
      cachedInputMicroUsdPerMTok: 312_500,
    },
    verifiedAt: '2026-09-06',
    source: 'vendor-docs',
  },
  [registryKey('deepseek', 'deepseek-chat')]: {
    tools: true,
    // DeepSeek's API documents a JSON "output mode", not a schema-conforming
    // response format — tool-call coercion is the honest ceiling.
    structuredOutput: 'tool-call',
    promptCaching: true,
    vision: false,
    contextWindow: 64_000,
    // Verified against DeepSeek's own API documentation: no first-party
    // embeddings endpoint exists.
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 270_000,
      outputMicroUsdPerMTok: 1_100_000,
      cachedInputMicroUsdPerMTok: 70_000,
    },
    verifiedAt: '2026-09-06',
    source: 'vendor-docs',
  },
  [registryKey('openrouter', 'meta-llama/llama-3.1-70b-instruct')]: {
    tools: true,
    // The proxied route's own capability, not inherited from any native
    // entry (design.md — "OpenRouter overlap"): no guarantee of native
    // schema support survives the proxy.
    structuredOutput: 'prompted',
    // Caching does not survive the proxy (design.md D13) — explicitly
    // false regardless of what the underlying model supports natively.
    promptCaching: false,
    vision: false,
    contextWindow: 131_072,
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 520_000,
      outputMicroUsdPerMTok: 750_000,
      cachedInputMicroUsdPerMTok: 520_000,
    },
    verifiedAt: '2026-09-06',
    source: 'vendor-docs',
    proxiedModel: 'meta-llama/llama-3.1-70b-instruct',
  },
});

/**
 * Looks up a model's capabilities. There is no default branch: an absent
 * entry is a typed refusal, never an optimistic guess (design.md D10).
 */
export function capabilitiesOf(ref: ModelRef): Result<ModelCapabilities, UnknownModel> {
  const key = registryKey(ref.provider, ref.slug);
  const capabilities = MODEL_REGISTRY[key];

  if (!capabilities) {
    return err({ reason: 'unknown-model', ref });
  }

  return ok(capabilities);
}
