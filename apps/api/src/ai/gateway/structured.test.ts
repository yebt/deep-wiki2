/**
 * Structured-output degradation ladder, against a fake `ChatModelPort`
 * (design.md — "Testing strategy"). No network, no real provider — the
 * point of this suite is the ladder's own policy: which rung runs, when
 * it degrades, when it repairs, and that every rung is its own ledger
 * event.
 */
import { describe, expect, test } from 'bun:test';
import { ok, Secret, type ChatModelPort, type ChatRequest, type ChatResult, type ProviderError, type Result, type StructuredOutputLevel } from '@deep-wiki/core';
import { generateStructured, type CapabilityObservation, type StructuredLedgerDeps, type StructuredOutputDeps } from './structured';

const VALID_JSON = '{"answer":"ok"}';
const INVALID_JSON = '{"oops":true}';

/** Passes only the fixed VALID_JSON shape — enough to exercise the ladder's branching without a real JSON-schema library. */
function fakeValidate(candidate: string): boolean {
  return candidate === VALID_JSON;
}

class ScriptedChatModel implements ChatModelPort {
  readonly calls: { level: StructuredOutputLevel | undefined; volatileCount: number }[] = [];

  constructor(private readonly responses: readonly string[]) {}

  async generate(request: ChatRequest): Promise<Result<ChatResult, ProviderError>> {
    const index = this.calls.length;
    this.calls.push({ level: request.structuredOutput?.level, volatileCount: request.volatile.length });
    const text = this.responses[index] ?? this.responses[this.responses.length - 1]!;
    return ok({ text, usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 }, finishReason: 'stop' });
  }

  async stream(): Promise<Result<never, ProviderError>> {
    throw new Error('not used in this suite');
  }
}

function baseRequest() {
  return {
    model: { provider: 'anthropic' as const, slug: 'claude-3-5-sonnet-20241022' },
    prefix: { text: 'sys', hash: 'h', cacheBoundary: 3 },
    volatile: [],
    maxOutputTokens: 100,
  };
}

interface Harness {
  readonly deps: StructuredOutputDeps;
  readonly admitCount: () => number;
  readonly settleCount: () => number;
  readonly voidCount: () => number;
  readonly observations: CapabilityObservation[];
  readonly chatModel: ScriptedChatModel;
}

function buildHarness(responses: readonly string[]): Harness {
  let admits = 0;
  let settles = 0;
  let voids = 0;
  const observations: CapabilityObservation[] = [];
  const chatModel = new ScriptedChatModel(responses);

  const ledger: StructuredLedgerDeps = {
    admit: async () => {
      admits += 1;
      return ok({ id: `r${admits}`, state: 'reserved', reservedMicroUsd: 10, expiresAt: '2026-01-01T00:15:00.000Z' });
    },
    settle: async () => {
      settles += 1;
      return ok(undefined);
    },
    void: async () => {
      voids += 1;
      return ok(undefined);
    },
  };

  const deps: StructuredOutputDeps = {
    chatModel,
    key: new Secret('sk-fake'),
    validate: fakeValidate,
    ledger,
    recordObservation: async (observation) => {
      observations.push(observation);
    },
  };

  return { deps, admitCount: () => admits, settleCount: () => settles, voidCount: () => voids, observations, chatModel };
}

describe('schema-level model', () => {
  test('uses the native path with no repair pass', async () => {
    const { deps, admitCount } = buildHarness([VALID_JSON]);

    const result = await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'schema' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.level).toBe('schema');
    }
    expect(admitCount()).toBe(1);
  });
});

describe('tool-call-level model', () => {
  test('is coerced through a single required tool and returns conforming output', async () => {
    const { deps, chatModel } = buildHarness([VALID_JSON]);

    const result = await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'tool-call' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.level).toBe('tool-call');
    }
    expect(chatModel.calls[0]!.level).toBe('tool-call');
  });

  test('the runtime never attempts a rung above the declared level', async () => {
    const { deps, chatModel } = buildHarness([VALID_JSON]);

    await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'tool-call' });

    expect(chatModel.calls.map((c) => c.level)).not.toContain('schema');
  });
});

describe('prompted-level model', () => {
  test('a first response failing validation gets exactly one repair pass carrying the error verbatim', async () => {
    const { deps, chatModel } = buildHarness([INVALID_JSON, VALID_JSON]);

    const result = await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'prompted' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.level).toBe('prompted');
    }
    expect(chatModel.calls).toHaveLength(2);
    // The repair pass carries the prior validation error as an added volatile turn.
    expect(chatModel.calls[1]!.volatileCount).toBe(chatModel.calls[0]!.volatileCount + 1);
  });

  test('a repair pass that also fails returns a typed structured_output_failed, never a silent {}', async () => {
    const { deps, chatModel } = buildHarness([INVALID_JSON, INVALID_JSON]);

    const result = await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'prompted' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('structured_output_failed');
    }
    expect(chatModel.calls).toHaveLength(2);
  });

  test('never attempts a third pass beyond the one repair', async () => {
    const { deps, chatModel } = buildHarness([INVALID_JSON, INVALID_JSON, VALID_JSON]);

    await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'prompted' });

    expect(chatModel.calls).toHaveLength(2);
  });
});

describe('runtime contradiction — dropping below the declared level', () => {
  test('a schema-level model that fails validation records an observation and degrades one rung', async () => {
    const { deps, observations, chatModel } = buildHarness([INVALID_JSON, VALID_JSON]);

    const result = await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'schema' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.level).toBe('tool-call');
    }
    expect(observations).toHaveLength(1);
    expect(observations[0]).toEqual({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet-20241022',
      declaredLevel: 'schema',
      observedLevel: 'tool-call',
      errorCode: 'validation_failed',
    });
    expect(chatModel.calls.map((c) => c.level)).toEqual(['schema', 'tool-call']);
  });
});

describe('every rung is a ledger event', () => {
  test('a repair pass produces its own ledger admit/settle pair', async () => {
    const { deps, admitCount, settleCount } = buildHarness([INVALID_JSON, VALID_JSON]);

    await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'prompted' });

    expect(admitCount()).toBe(2);
    expect(settleCount()).toBe(2);
  });

  test('a schema-to-tool-call degradation produces two separate ledger events', async () => {
    const { deps, admitCount } = buildHarness([INVALID_JSON, VALID_JSON]);

    await generateStructured(deps, { baseRequest: baseRequest(), schemaJson: '{}', declaredLevel: 'schema' });

    expect(admitCount()).toBe(2);
  });
});
