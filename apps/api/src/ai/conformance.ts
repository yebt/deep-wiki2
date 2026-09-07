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
import { buildPrefix, capabilitiesOf, ok, parseModelId, type ChatModelPort, type ChatRequest, type Secret } from '@deep-wiki/core';
import { generateStructured, type StructuredLedgerDeps } from './gateway/structured';

export interface ConformanceResult {
  readonly modelId: string;
  readonly declaredLevel: string;
  readonly matched: boolean;
  readonly detail: string;
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
 * A real reservation is not the point here — `ai:conformance` accounts
 * for its own spend by inspecting `ai_usage_events` afterwards, the same
 * as any other call — so this ledger only satisfies `StructuredLedgerDeps`'s
 * shape without touching a database.
 */
function noOpLedger(): StructuredLedgerDeps {
  return {
    admit: async () =>
      ok({ id: crypto.randomUUID(), state: 'reserved', reservedMicroUsd: 0, expiresAt: new Date(Date.now() + 900_000).toISOString() }),
    settle: async () => ok(undefined),
    void: async () => ok(undefined),
  };
}

export async function runConformanceCase(chatModel: ChatModelPort, key: Secret<string>, modelId: string): Promise<ConformanceResult> {
  const modelRef = parseModelId(modelId);
  if (!modelRef.ok) {
    return { modelId, declaredLevel: 'none', matched: false, detail: `invalid model id (${modelRef.error.reason})` };
  }

  const capabilities = capabilitiesOf(modelRef.value);
  if (!capabilities.ok) {
    return { modelId, declaredLevel: 'none', matched: false, detail: 'model is not in the capability registry' };
  }

  const declaredLevel = capabilities.value.structuredOutput;
  if (declaredLevel === 'none') {
    return { modelId, declaredLevel, matched: true, detail: 'declared level is "none" — nothing to verify' };
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

  const result = await generateStructured(
    { chatModel, key, validate: (candidate) => validatesAgainstFixedSchema(candidate), ledger: noOpLedger(), recordObservation: async () => {} },
    { baseRequest, schemaJson: FIXED_SCHEMA_JSON, declaredLevel },
  );

  if (!result.ok) {
    return { modelId, declaredLevel, matched: false, detail: `the ladder never produced valid output at or below "${declaredLevel}" (${result.error.code})` };
  }
  if (result.value.level !== declaredLevel) {
    return { modelId, declaredLevel, matched: false, detail: `only achieved after degrading to "${result.value.level}" — the declared level was not honored` };
  }
  return { modelId, declaredLevel, matched: true, detail: `honored its declared "${declaredLevel}" level` };
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
