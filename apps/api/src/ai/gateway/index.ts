/**
 * The single AI gateway (design.md — "Cost enforcement, in the same path
 * that builds the call"; D1). This directory is the one place a provider
 * client is ever constructed (`scripts/checks/query-boundaries.ts` rule
 * 6): `generate`/`stream` below run the exact 8-step call path —
 * `parseModelId -> capabilitiesOf -> buildPrefix -> ledger.admit ->
 * openCredential -> resolveChatModel -> generate/stream -> settle/void`.
 * An unregistered model or an over-budget workspace is refused before
 * `openCredential` is ever reached, and `openCredential` itself is the
 * repository's decryption boundary (rule 7) — this module never imports
 * the cipher directly.
 */
import {
  buildPrefix,
  capabilitiesOf,
  computeCostMicroUsd,
  err,
  ok,
  parseModelId,
  type ChatModelPort,
  type ChatRequest,
  type ChatResult,
  type ChatStream,
  type ProviderId,
  type PromptPart,
  type Result,
  type Secret,
  type StablePrefixInput,
  type SubjectKind,
  type UsageLedger,
} from '@deep-wiki/core';

export type GatewayErrorCode = 'invalid-model' | 'unknown-model' | 'over-budget' | 'credential-unavailable' | 'provider-error';

export interface GatewayError {
  readonly code: GatewayErrorCode;
  readonly message: string;
}

export type OpenCredential = (
  workspaceId: string,
  provider: ProviderId,
) => Promise<Result<Secret<string>, { readonly reason: string }>>;

export interface GatewayDeps {
  readonly ledger: UsageLedger;
  /** Bound to the caller's `sql`/`cipher` at the composition root — the gateway never imports the cipher itself (rule 7). */
  readonly openCredential: OpenCredential;
  /** The real implementation constructs a Vercel AI SDK client (Phase 13); a test injects a fake. */
  readonly resolveChatModel: (provider: ProviderId) => ChatModelPort;
  readonly reservationTtlSeconds: number;
}

export interface GatewayChatRequest {
  readonly workspaceId: string;
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
  /** `<providerId>:<slug>` — never trusted as a `ModelRef` until `parseModelId` accepts it. */
  readonly rawModelId: string;
  readonly prefixInput: StablePrefixInput;
  readonly volatile: readonly PromptPart[];
  readonly maxOutputTokens: number;
  readonly nowIso: string;
  readonly periodStart: string;
}

/**
 * A deliberately conservative estimate: the reservation only needs to be
 * an upper bound (design.md D3), not an exact count — the provider's own
 * accounting is what `settle()` records as truth.
 */
function estimateInputTokens(prefixText: string, volatile: readonly PromptPart[]): number {
  const volatileChars = volatile.reduce((sum, part) => sum + part.text.length, 0);
  return Math.ceil((prefixText.length + volatileChars) / 4);
}

interface Admitted {
  readonly id: string;
  readonly prefix: ReturnType<typeof buildPrefix>;
  readonly chatModel: ChatModelPort;
  readonly chatRequest: ChatRequest;
  readonly credential: Secret<string>;
}

/** Steps 1-6: refuse before any client is constructed, admit, then decrypt. Shared by `generate` and `stream`. */
async function admitAndOpen(deps: GatewayDeps, request: GatewayChatRequest): Promise<Result<Admitted, GatewayError>> {
  const modelRef = parseModelId(request.rawModelId);
  if (!modelRef.ok) {
    return err({ code: 'invalid-model', message: `invalid model id "${request.rawModelId}"` });
  }

  const capabilities = capabilitiesOf(modelRef.value);
  if (!capabilities.ok) {
    return err({ code: 'unknown-model', message: `model "${request.rawModelId}" is not in the capability registry` });
  }

  const prefix = buildPrefix(request.prefixInput);

  const expiresAtIso = new Date(Date.parse(request.nowIso) + deps.reservationTtlSeconds * 1000).toISOString();
  const reserveMicroUsd = computeCostMicroUsd(
    { inputTokens: estimateInputTokens(prefix.text, request.volatile), cachedInputTokens: 0, outputTokens: request.maxOutputTokens },
    capabilities.value.pricing,
  );

  const admission = await deps.ledger.admit({
    workspaceId: request.workspaceId,
    periodStart: request.periodStart,
    subjectType: request.subjectType,
    subjectId: request.subjectId,
    provider: modelRef.value.provider,
    model: modelRef.value.slug,
    operation: 'chat',
    reserveMicroUsd,
    nowIso: request.nowIso,
    expiresAtIso,
    prefixHash: prefix.hash,
  });
  if (!admission.ok) {
    return err({
      code: 'over-budget',
      message: `workspace is over its AI budget (limit ${admission.error.limitMicroUsd} micro-usd, outstanding ${admission.error.outstandingMicroUsd} micro-usd)`,
    });
  }

  // Decryption happens only here — after admission succeeds, never before.
  const credential = await deps.openCredential(request.workspaceId, modelRef.value.provider);
  if (!credential.ok) {
    await deps.ledger.void(admission.value.id, 'error');
    return err({ code: 'credential-unavailable', message: `no usable credential for provider "${modelRef.value.provider}"` });
  }

  const chatRequest: ChatRequest = {
    model: modelRef.value,
    prefix,
    volatile: request.volatile,
    maxOutputTokens: request.maxOutputTokens,
  };

  return ok({
    id: admission.value.id,
    prefix,
    chatModel: deps.resolveChatModel(modelRef.value.provider),
    chatRequest,
    credential: credential.value,
  });
}

/** Steps 1-8, non-streaming: settles on success, voids on a provider error. */
export async function generate(deps: GatewayDeps, request: GatewayChatRequest): Promise<Result<ChatResult, GatewayError>> {
  const admitted = await admitAndOpen(deps, request);
  if (!admitted.ok) {
    return admitted;
  }

  const result = await admitted.value.chatModel.generate(admitted.value.chatRequest, admitted.value.credential);
  if (!result.ok) {
    await deps.ledger.void(admitted.value.id, 'error');
    return err({ code: 'provider-error', message: result.error.message });
  }

  await deps.ledger.settle(admitted.value.id, result.value.usage);
  return ok(result.value);
}

/**
 * Steps 1-8, streaming: settles once `usage` resolves (`onFinish`), voids
 * on a provider error or an abort signal (`onAbort`/`onError`). Neither
 * firing is not a leak — the reservation's own `expiresAt` excludes it
 * from the outstanding sum once `AI_RESERVATION_TTL_SECONDS` passes, with
 * no sweeper (D4).
 */
export async function stream(
  deps: GatewayDeps,
  request: GatewayChatRequest,
  signal?: AbortSignal,
): Promise<Result<ChatStream, GatewayError>> {
  const admitted = await admitAndOpen(deps, request);
  if (!admitted.ok) {
    return admitted;
  }

  const result = await admitted.value.chatModel.stream(admitted.value.chatRequest, admitted.value.credential);
  if (!result.ok) {
    await deps.ledger.void(admitted.value.id, 'error');
    return err({ code: 'provider-error', message: result.error.message });
  }

  let settled = false;
  const voidOnce = (reason: 'aborted' | 'error') => {
    if (settled) return;
    settled = true;
    void deps.ledger.void(admitted.value.id, reason);
  };

  if (signal) {
    if (signal.aborted) {
      voidOnce('aborted');
    } else {
      signal.addEventListener('abort', () => voidOnce('aborted'), { once: true });
    }
  }

  result.value.usage
    .then((usage) => {
      if (settled) return;
      settled = true;
      void deps.ledger.settle(admitted.value.id, usage);
    })
    .catch(() => voidOnce('error'));

  return ok(result.value);
}
