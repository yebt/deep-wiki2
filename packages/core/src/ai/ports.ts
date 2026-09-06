/**
 * The five ports every provider adapter, key-management adapter, and
 * ledger adapter must implement (design.md — "The provider abstraction").
 * Every field and parameter here is a `Result`, a `Secret`, a JS
 * primitive, `Uint8Array`, or `AsyncIterable<T>` — never a Vercel AI SDK
 * type, not even as a type-only import. `core-purity.ts` rule 3 (Phase 1)
 * is the machine-enforced regression guard: a raw-source scan over this
 * exact file, immune to the type-only elision a naive AST import scan has.
 *
 * Adapters live outside `packages/core` — the Vercel AI SDK providers in
 * `apps/api/src/ai/gateway/`, the cipher and key providers in
 * `apps/api/src/adapters/ai/` — exactly where Phase 1 placed `MailSender`
 * and `BlobStore`.
 */
import { type Result } from '../result';
import type { Secret } from '../secret';
import type { ChatUsage } from './pricing';
import type { CredentialAad } from './aad';
import type { AdmissionInput, BudgetRefusal, Reservation, VoidReason } from './budget';
import type { ModelRef } from './ids';
import type { StablePrefix } from './prefix';
import type { StructuredOutputLevel } from './registry';

export interface PromptPart {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface ChatRequest {
  /** Parsed, never a raw user string — see `parseModelId`. */
  readonly model: ModelRef;
  readonly prefix: StablePrefix;
  readonly volatile: readonly PromptPart[];
  /** Required — a call that will not name its ceiling cannot be admitted (D3). */
  readonly maxOutputTokens: number;
  readonly structuredOutput?: {
    readonly schemaJson: string;
    readonly level: StructuredOutputLevel;
  };
}

export type ChatFinishReason = 'stop' | 'length' | 'tool-calls' | 'content-filter' | 'error';

export interface ChatResult {
  readonly text: string;
  readonly usage: ChatUsage;
  readonly finishReason: ChatFinishReason;
}

export interface ChatStream {
  readonly chunks: AsyncIterable<string>;
  readonly usage: Promise<ChatUsage>;
}

export type ProviderErrorCode = 'rate-limit' | 'auth' | 'network' | 'unknown';

/**
 * Never carries the raw upstream payload or a credential value
 * (ai-provider-registry spec — "Normalized Provider Errors").
 */
export interface ProviderError {
  readonly code: ProviderErrorCode;
  readonly message: string;
}

export interface EmbedRequest {
  readonly model: ModelRef;
  readonly input: readonly string[];
}

export interface EmbedResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly usage: { readonly inputTokens: number };
}

export interface KeyError {
  readonly reason: string;
}

export interface CipherError {
  readonly reason: string;
}

export interface SealedCredential {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly authTag: Uint8Array;
  readonly wrappedDek: Uint8Array;
  readonly keyId: string;
}

export interface LedgerError {
  readonly reason: string;
}

export interface ChatModelPort {
  generate(request: ChatRequest, key: Secret<string>): Promise<Result<ChatResult, ProviderError>>;
  stream(request: ChatRequest, key: Secret<string>): Promise<Result<ChatStream, ProviderError>>;
}

export interface EmbeddingModelPort {
  embed(request: EmbedRequest, key: Secret<string>): Promise<Result<EmbedResult, ProviderError>>;
}

export interface KeyProvider {
  activeKeyId(): string;
  wrap(dek: Uint8Array, keyId: string): Promise<Result<Uint8Array, KeyError>>;
  unwrap(wrapped: Uint8Array, keyId: string): Promise<Result<Uint8Array, KeyError>>;
}

export interface CredentialCipher {
  seal(plaintext: Secret<string>, aad: CredentialAad): Promise<Result<SealedCredential, CipherError>>;
  open(sealed: SealedCredential, aad: CredentialAad): Promise<Result<Secret<string>, CipherError>>;
}

export interface UsageLedger {
  admit(input: AdmissionInput): Promise<Result<Reservation, BudgetRefusal>>;
  settle(id: string, usage: ChatUsage): Promise<Result<void, LedgerError>>;
  void(id: string, reason: VoidReason): Promise<Result<void, LedgerError>>;
}
