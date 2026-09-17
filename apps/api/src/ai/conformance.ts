/**
 * Live conformance (design.md — "Drift detection" — "Live conformance";
 * proposal — "The structured-output conformance suite passes at each
 * model's declared degradation level"). Runs one fixed schema through a
 * `ChatModelPort` at the model's registry-declared `structuredOutput`
 * level via Phase 14's own ladder (`./gateway/structured.ts`) — this is
 * not a second, hand-rolled degradation policy, it is the real one,
 * exercised end to end. A mismatch is either the ladder failing outright
 * (`structured_output_failed`) or succeeding only after degrading below
 * the declared rung — both are "works on Anthropic, fails on DeepSeek"
 * hiding in the fallback chain (proposal — Risks), and both are reported
 * rather than swallowed.
 *
 * Opt-in only: needs a real key and spends money on every rung attempted
 * (`ai:conformance` — never part of `bun run test`).
 */
import {
  buildPrefix,
  capabilitiesOf,
  computeCostMicroUsd,
  ok,
  parseModelId,
  type ChatModelPort,
  type ChatRequest,
  type ChatUsage,
  type ModelPricing,
  type Secret,
} from '@deep-wiki/core';
import { generateStructured, type StructuredLedgerDeps } from './gateway/structured';

export interface ConformanceResult {
  readonly modelId: string;
  readonly declaredLevel: string;
  readonly matched: boolean;
  readonly detail: string;
  /** Rungs the ladder actually called the provider for — a repair pass counts (D12). */
  readonly rungs: number;
  /** Summed over every rung, as the provider reported it. */
  readonly usage: ChatUsage;
  /** `usage` priced at the registry's table for this model — what the run cost, in the ledger's unit. */
  readonly costMicroUsd: number;
  readonly elapsedMs: number;
}

const NO_USAGE: ChatUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };

function unreached(modelId: string, declaredLevel: string, detail: string): ConformanceResult {
  return { modelId, declaredLevel, matched: false, detail, rungs: 0, usage: NO_USAGE, costMicroUsd: 0, elapsedMs: 0 };
}

/** One fixed schema, deliberately trivial — conformance tests the ladder's mechanics, not a model's reasoning. */
const FIXED_SCHEMA_JSON = JSON.stringify({
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
});

function validatesAgainstFixedSchema(candidateJson: string): boolean {
  try {
    const parsed = JSON.parse(candidateJson) as Record<string, unknown>;
    return typeof parsed.answer === 'string';
  } catch {
    return false;
  }
}

/**
 * A real reservation is not the point here — nothing in this run belongs
 * to a workspace, so there is no `ai_usage_events` row to write — but the
 * settled usage is the run's own bill, so this ledger tallies every rung
 * it settles (a repair pass is its own rung, D12) and prices the total at
 * the registry's table for the model.
 */
interface TallyingLedger extends StructuredLedgerDeps {
  readonly total: () => { readonly rungs: number; readonly usage: ChatUsage };
}

function tallyingLedger(): TallyingLedger {
  let rungs = 0;
  let usage: ChatUsage = NO_USAGE;
  return {
    admit: async () =>
      ok({ id: crypto.randomUUID(), state: 'reserved', reservedMicroUsd: 0, expiresAt: new Date(Date.now() + 900_000).toISOString() }),
    settle: async (_reservationId, settled) => {
      rungs += 1;
      usage = {
        inputTokens: usage.inputTokens + settled.inputTokens,
        cachedInputTokens: usage.cachedInputTokens + settled.cachedInputTokens,
        outputTokens: usage.outputTokens + settled.outputTokens,
      };
      return ok(undefined);
    },
    void: async () => {
      // A provider error still made a call; it just reported no usage.
      rungs += 1;
      return ok(undefined);
    },
    total: () => ({ rungs, usage }),
  };
}

function priced(modelId: string, declaredLevel: string, matched: boolean, detail: string, ledger: TallyingLedger, pricing: ModelPricing, startedAt: number): ConformanceResult {
  const { rungs, usage } = ledger.total();
  return { modelId, declaredLevel, matched, detail, rungs, usage, costMicroUsd: computeCostMicroUsd(usage, pricing), elapsedMs: Math.round(performance.now() - startedAt) };
}

export async function runConformanceCase(chatModel: ChatModelPort, key: Secret<string>, modelId: string): Promise<ConformanceResult> {
  const modelRef = parseModelId(modelId);
  if (!modelRef.ok) {
    return unreached(modelId, 'none', `invalid model id (${modelRef.error.reason})`);
  }

  const capabilities = capabilitiesOf(modelRef.value);
  if (!capabilities.ok) {
    return unreached(modelId, 'none', 'model is not in the capability registry');
  }

  const declaredLevel = capabilities.value.structuredOutput;
  if (declaredLevel === 'none') {
    return { ...unreached(modelId, declaredLevel, 'declared level is "none" — nothing to verify'), matched: true };
  }

  const baseRequest: ChatRequest = {
    model: modelRef.value,
    prefix: buildPrefix({
      tools: [],
      system: 'Respond only with JSON matching the provided schema.',
      teamRulePacks: [],
      document: '',
      question: '',
    }),
    volatile: [{ role: 'user', text: 'Return a JSON object with a single string field named "answer".' }],
    maxOutputTokens: 64,
  };

  const ledger = tallyingLedger();
  const startedAt = performance.now();
  const result = await generateStructured(
    { chatModel, key, validate: (candidate) => validatesAgainstFixedSchema(candidate), ledger, recordObservation: async () => {} },
    { baseRequest, schemaJson: FIXED_SCHEMA_JSON, declaredLevel },
  );
  const pricing = capabilities.value.pricing;

  if (!result.ok) {
    return priced(modelId, declaredLevel, false, `the ladder never produced valid output at or below "${declaredLevel}" (${result.error.code})`, ledger, pricing, startedAt);
  }
  if (result.value.level !== declaredLevel) {
    return priced(modelId, declaredLevel, false, `only achieved after degrading to "${result.value.level}" — the declared level was not honored`, ledger, pricing, startedAt);
  }
  return priced(modelId, declaredLevel, true, `honored its declared "${declaredLevel}" level`, ledger, pricing, startedAt);
}

export async function runConformanceSuite(
  cases: readonly { readonly modelId: string; readonly chatModel: ChatModelPort; readonly key: Secret<string> }[],
): Promise<readonly ConformanceResult[]> {
  const results: ConformanceResult[] = [];
  for (const testCase of cases) {
    results.push(await runConformanceCase(testCase.chatModel, testCase.key, testCase.modelId));
  }
  return results;
}
