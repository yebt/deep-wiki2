/**
 * Structured-output degradation ladder (design.md — "Capability registry
 * and structured-output degradation"; ai-provider-registry spec —
 * "Structured-Output Graceful Degradation"). Starts exactly at the
 * model's declared level (`ModelCapabilities.structuredOutput`) and never
 * climbs back above it — a validation failure at `schema` or `tool-call`
 * is a **runtime contradiction** (D11): it writes an
 * `ai_capability_observations` row and degrades one rung, per
 * `packages/core/src/ai/degrade.ts`'s fixed ladder. `prompted` has no
 * lower rung to fall back to; instead it gets exactly **one** repair
 * pass carrying the validation error verbatim, and a typed
 * `structured_output_failed` — never a silent `{}` — if that also fails.
 *
 * Every rung is its own ledger event (D12): a repair pass costs money and
 * must appear in accounting rather than hiding inside one "call". The
 * ledger admission/settlement primitives are injected as thunks so this
 * module stays independent of `LedgerAdmissionInput`'s full attribution
 * shape — the caller (the gateway) already knows the workspace/subject
 * context and binds it once.
 */
import { degrade, err, ok, type BudgetRefusal, type ChatModelPort, type ChatRequest, type ChatUsage, type LedgerError, type ProviderId, type Reservation, type Result, type Secret, type StructuredOutputLevel, type VoidReason } from '@deep-wiki/core';

export interface StructuredLedgerDeps {
  readonly admit: () => Promise<Result<Reservation, BudgetRefusal>>;
  readonly settle: (reservationId: string, usage: ChatUsage) => Promise<Result<void, LedgerError>>;
  readonly void: (reservationId: string, reason: VoidReason) => Promise<Result<void, LedgerError>>;
}

export interface CapabilityObservation {
  readonly provider: ProviderId;
  readonly model: string;
  readonly declaredLevel: StructuredOutputLevel;
  readonly observedLevel: StructuredOutputLevel;
  readonly errorCode: string;
}

export interface StructuredOutputDeps {
  readonly chatModel: ChatModelPort;
  readonly key: Secret<string>;
  /** Real production validation is a JSON-schema library; a test injects a fake. */
  readonly validate: (candidateJson: string, schemaJson: string) => boolean;
  readonly ledger: StructuredLedgerDeps;
  readonly recordObservation: (observation: CapabilityObservation) => Promise<void>;
}

export interface StructuredRequest {
  readonly baseRequest: ChatRequest;
  readonly schemaJson: string;
  /** The registry's `capabilities.structuredOutput` — a ceiling never exceeded. */
  readonly declaredLevel: StructuredOutputLevel;
}

export type StructuredOutputErrorCode = 'structured_output_failed' | 'over-budget' | 'provider-error';

export interface StructuredOutputError {
  readonly code: StructuredOutputErrorCode;
  readonly message: string;
}

export interface StructuredOutputSuccess {
  readonly json: string;
  readonly level: StructuredOutputLevel;
}

type RungErrorCode = 'validation-failed' | 'over-budget' | 'provider-error';

interface RungError {
  readonly code: RungErrorCode;
  readonly message: string;
}

function toStructuredOutputError(rungError: RungError): StructuredOutputError {
  return { code: rungError.code === 'validation-failed' ? 'structured_output_failed' : rungError.code, message: rungError.message };
}

/** One rung, one ledger event (D12): admit, call, settle/void, validate. */
async function runRung(
  deps: StructuredOutputDeps,
  request: StructuredRequest,
  level: StructuredOutputLevel,
): Promise<Result<StructuredOutputSuccess, RungError>> {
  const admission = await deps.ledger.admit();
  if (!admission.ok) {
    return err({ code: 'over-budget', message: `over budget attempting the "${level}" rung` });
  }

  const chatRequest: ChatRequest = { ...request.baseRequest, structuredOutput: { schemaJson: request.schemaJson, level } };
  const result = await deps.chatModel.generate(chatRequest, deps.key);
  if (!result.ok) {
    await deps.ledger.void(admission.value.id, 'error');
    return err({ code: 'provider-error', message: result.error.message });
  }

  await deps.ledger.settle(admission.value.id, result.value.usage);

  if (!deps.validate(result.value.text, request.schemaJson)) {
    return err({ code: 'validation-failed', message: `response did not validate against the schema at the "${level}" rung` });
  }

  return ok({ json: result.value.text, level });
}

export async function generateStructured(
  deps: StructuredOutputDeps,
  request: StructuredRequest,
): Promise<Result<StructuredOutputSuccess, StructuredOutputError>> {
  let level = request.declaredLevel;

  // `schema` and `tool-call`: one attempt each. A validation failure here
  // is the provider contradicting its own declared capability — record
  // it and degrade exactly one rung, never more, never fewer.
  while (level === 'schema' || level === 'tool-call') {
    const attempt = await runRung(deps, request, level);
    if (attempt.ok) {
      return attempt;
    }
    if (attempt.error.code !== 'validation-failed') {
      return err(toStructuredOutputError(attempt.error));
    }

    const nextLevel = degrade(level);
    if (!nextLevel) {
      // Unreachable for 'schema'/'tool-call' (only 'none' degrades to
      // null) — kept as a typed fallback rather than a non-null assertion.
      return err({ code: 'structured_output_failed', message: 'degradation ladder produced no lower rung' });
    }

    await deps.recordObservation({
      provider: request.baseRequest.model.provider,
      model: request.baseRequest.model.slug,
      declaredLevel: request.declaredLevel,
      observedLevel: nextLevel,
      errorCode: 'validation_failed',
    });
    level = nextLevel;
  }

  if (level === 'prompted') {
    const first = await runRung(deps, request, 'prompted');
    if (first.ok) {
      return first;
    }
    if (first.error.code !== 'validation-failed') {
      return err(toStructuredOutputError(first.error));
    }

    // Exactly one repair pass, carrying the validation error verbatim.
    const repairRequest: StructuredRequest = {
      ...request,
      baseRequest: {
        ...request.baseRequest,
        volatile: [
          ...request.baseRequest.volatile,
          {
            role: 'user',
            text: `Your previous response did not conform to the required schema: ${first.error.message}. Return only valid JSON conforming to the schema, nothing else.`,
          },
        ],
      },
    };
    const repaired = await runRung(deps, repairRequest, 'prompted');
    if (repaired.ok) {
      return repaired;
    }
    if (repaired.error.code !== 'validation-failed') {
      return err(toStructuredOutputError(repaired.error));
    }

    return err({ code: 'structured_output_failed', message: 'structured output failed validation after one repair pass' });
  }

  // level === 'none': not attempted at all (design.md's ladder table).
  return err({ code: 'structured_output_failed', message: 'model has no usable structured-output level' });
}
