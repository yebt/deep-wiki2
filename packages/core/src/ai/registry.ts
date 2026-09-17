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
 *
 * **Cheap models first** (docs/TODO.md Finding 2026-09-17). The default
 * model of every AI feature is the cheapest one that passes conformance;
 * an expensive model is an upgrade, never the baseline. `defaultModelFor`
 * is that rule's mechanism, and `registry.test.ts` holds every declared
 * default to it: a default must be a `source: 'probe'` entry (measured,
 * not quoted from a vendor page) and the cheapest such entry for its
 * provider. The OpenRouter entries below carry `structuredOutput:
 * 'prompted'` because that is the rung `ai:conformance` measured through
 * the real ladder — OpenRouter's catalogue *declares* `structured_outputs`
 * for these routes, but no adapter sends a schema on the wire yet, so a
 * higher rung would be a claim the runtime cannot exercise.
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
  // ── OpenRouter ──────────────────────────────────────────────────────
  // Every entry describes the proxied route's own capability, never
  // inherited from a native entry (design.md — "OpenRouter overlap"), and
  // caching does not survive the proxy (D13) — `promptCaching` is false
  // regardless of what the underlying model supports natively. Prices are
  // OpenRouter's catalogue on `verifiedAt` (`ai:catalogue`); the cached
  // rate is the catalogue's `input_cache_read` where it lists one and the
  // input rate otherwise.
  [registryKey('openrouter', 'mistralai/mistral-nemo')]: {
    tools: true,
    structuredOutput: 'prompted',
    promptCaching: false,
    vision: false,
    contextWindow: 131_072,
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 19_000,
      outputMicroUsdPerMTok: 30_000,
      cachedInputMicroUsdPerMTok: 19_000,
    },
    verifiedAt: '2026-09-17',
    source: 'probe',
    proxiedModel: 'mistralai/mistral-nemo',
  },
  [registryKey('openrouter', 'meta-llama/llama-3.1-8b-instruct')]: {
    tools: true,
    structuredOutput: 'prompted',
    promptCaching: false,
    vision: false,
    contextWindow: 131_072,
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 50_000,
      outputMicroUsdPerMTok: 80_000,
      cachedInputMicroUsdPerMTok: 25_000,
    },
    verifiedAt: '2026-09-17',
    source: 'probe',
    proxiedModel: 'meta-llama/llama-3.1-8b-instruct',
  },
  [registryKey('openrouter', 'qwen/qwen3-30b-a3b-instruct-2507')]: {
    tools: true,
    structuredOutput: 'prompted',
    promptCaching: false,
    vision: false,
    contextWindow: 262_144,
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 48_000,
      outputMicroUsdPerMTok: 193_000,
      cachedInputMicroUsdPerMTok: 48_000,
    },
    verifiedAt: '2026-09-17',
    source: 'probe',
    proxiedModel: 'qwen/qwen3-30b-a3b-instruct-2507',
  },
  // The expensive upgrade, kept on purpose: roughly ten to twenty times
  // the price of the routes above per token.
  [registryKey('openrouter', 'meta-llama/llama-3.1-70b-instruct')]: {
    tools: true,
    structuredOutput: 'prompted',
    promptCaching: false,
    vision: false,
    contextWindow: 131_072,
    embeddings: false,
    pricing: {
      inputMicroUsdPerMTok: 400_000,
      outputMicroUsdPerMTok: 400_000,
      cachedInputMicroUsdPerMTok: 400_000,
    },
    verifiedAt: '2026-09-17',
    source: 'vendor-docs',
    proxiedModel: 'meta-llama/llama-3.1-70b-instruct',
  },
});

/**
 * The cheapest conformance-passing entry per provider (docs/TODO.md
 * Finding 2026-09-17 — "Cheap models first"). A provider absent here has
 * no default and `defaultModelFor` refuses rather than guessing. Frozen
 * and checked in for the same reason the registry is: the file, not
 * memory, is the source of truth.
 */
export const DEFAULT_MODEL_BY_PROVIDER: Readonly<Partial<Record<ProviderId, string>>> = Object.freeze({
  openrouter: 'mistralai/mistral-nemo',
});

export interface NoDefaultModel {
  readonly reason: 'no-default-model';
  readonly provider: ProviderId;
}

/** The provider's default model, or a typed refusal when none is declared. Never an unregistered ref. */
export function defaultModelFor(provider: ProviderId): Result<ModelRef, NoDefaultModel> {
  const slug = DEFAULT_MODEL_BY_PROVIDER[provider];
  if (!slug || !MODEL_REGISTRY[registryKey(provider, slug)]) {
    return err({ reason: 'no-default-model', provider });
  }
  return ok({ provider, slug });
}

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
