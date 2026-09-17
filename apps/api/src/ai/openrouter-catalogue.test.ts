/**
 * `openrouter-catalogue.ts` — the parsing and ranking behind
 * `ai:catalogue`. Exercised against a hand-trimmed shape of the real
 * `GET /api/v1/models` and `GET /api/v1/embeddings/models` payloads
 * (2026-09-17), never against the network: the CLI is the only
 * network path, and it is opt-in.
 */
import { describe, expect, test } from 'bun:test';
import {
  parseOpenRouterCatalogue,
  rankCheapestChatModels,
  rankCheapestEmbeddingModels,
  renderMarkdownTable,
  toMicroUsdPerMTok,
} from './openrouter-catalogue';

function chat(id: string, prompt: string, completion: string, params: readonly string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    context_length: 131072,
    architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] },
    pricing: { prompt, completion },
    supported_parameters: params,
    ...extra,
  };
}

const TOOLS_AND_JSON = ['max_tokens', 'response_format', 'tools', 'tool_choice'];
const TOOLS_JSON_AND_SCHEMA = [...TOOLS_AND_JSON, 'structured_outputs'];

const MODELS_PAYLOAD = {
  data: [
    chat('vendor/expensive', '0.0000004', '0.0000004', TOOLS_JSON_AND_SCHEMA),
    chat('vendor/cheapest', '0.000000019', '0.00000003', TOOLS_JSON_AND_SCHEMA),
    chat('vendor/no-tools', '0.000000001', '0.000000001', ['max_tokens', 'response_format']),
    chat('vendor/no-json', '0.000000001', '0.000000001', ['max_tokens', 'tools']),
    chat('vendor/free:free', '0', '0', TOOLS_JSON_AND_SCHEMA),
    chat('vendor/cheapest:batch', '0.00000001', '0.00000001', TOOLS_JSON_AND_SCHEMA),
    chat('~vendor/alias-latest', '0.00000001', '0.00000001', TOOLS_JSON_AND_SCHEMA, { alias_target: 'vendor/cheapest' }),
    chat('vendor/middle', '0.00000005', '0.00000008', TOOLS_AND_JSON, { context_length: 32768 }),
    chat('openrouter/auto', '-1', '-1', TOOLS_JSON_AND_SCHEMA),
    {
      id: 'vendor/image-only',
      name: 'image',
      context_length: 1000,
      architecture: { modality: 'text->image', input_modalities: ['text'], output_modalities: ['image'] },
      pricing: { prompt: '0.000000001', completion: '0.000000001' },
      supported_parameters: TOOLS_JSON_AND_SCHEMA,
    },
  ],
};

const EMBEDDINGS_PAYLOAD = {
  data: [
    {
      id: 'vendor/embed-large',
      name: 'large',
      context_length: 8192,
      description: 'Produces 1,536-dimensional embeddings.',
      architecture: { modality: 'text->embeddings', input_modalities: ['text'], output_modalities: ['embeddings'] },
      pricing: { prompt: '0.00000002', completion: '0' },
      supported_parameters: [],
    },
    {
      id: 'vendor/embed-small',
      name: 'small',
      context_length: 512,
      description: 'A 384-dimensional text embedding model.',
      architecture: { modality: 'text->embeddings', input_modalities: ['text'], output_modalities: ['embeddings'] },
      pricing: { prompt: '0.000000005', completion: '0' },
      supported_parameters: [],
    },
    {
      id: 'vendor/embed-free:free',
      name: 'free',
      context_length: 512,
      description: 'no dimension stated',
      architecture: { modality: 'text->embeddings', input_modalities: ['text'], output_modalities: ['embeddings'] },
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: [],
    },
  ],
};

describe('parseOpenRouterCatalogue', () => {
  test('reads id, prices as micro-USD per million tokens, context length, output modalities and parameters', () => {
    const models = parseOpenRouterCatalogue(MODELS_PAYLOAD);

    const cheapest = models.find((model) => model.id === 'vendor/cheapest');
    expect(cheapest).toBeDefined();
    expect(cheapest!.inputMicroUsdPerMTok).toBe(19_000);
    expect(cheapest!.outputMicroUsdPerMTok).toBe(30_000);
    expect(cheapest!.contextLength).toBe(131072);
    expect(cheapest!.outputModalities).toEqual(['text']);
    expect(cheapest!.supportedParameters).toContain('structured_outputs');
  });

  test('refuses a payload that is not `{ data: [...] }` rather than returning an empty catalogue', () => {
    expect(() => parseOpenRouterCatalogue({ models: [] })).toThrow();
    expect(() => parseOpenRouterCatalogue('nope')).toThrow();
  });

  test('a row with a malformed price is refused, not silently priced at zero', () => {
    expect(() => parseOpenRouterCatalogue({ data: [chat('vendor/x', 'free', '0', TOOLS_AND_JSON)] })).toThrow();
  });

  test('OpenRouter\'s "-1" (a router with no fixed price) parses as an unpriced route, never as a negative price', () => {
    const [router] = parseOpenRouterCatalogue({ data: [chat('openrouter/auto', '-1', '-1', TOOLS_AND_JSON)] });

    expect(router!.inputMicroUsdPerMTok).toBeNull();
    expect(router!.outputMicroUsdPerMTok).toBeNull();
  });

  test('a declared embedding dimension is read from the description when the payload carries no field for it', () => {
    const models = parseOpenRouterCatalogue(EMBEDDINGS_PAYLOAD);

    expect(models.find((model) => model.id === 'vendor/embed-large')!.declaredDimensions).toBe(1536);
    expect(models.find((model) => model.id === 'vendor/embed-small')!.declaredDimensions).toBe(384);
    expect(models.find((model) => model.id === 'vendor/embed-free:free')!.declaredDimensions).toBeNull();
  });
});

describe('toMicroUsdPerMTok', () => {
  test('converts OpenRouter\'s per-token USD string into integer micro-USD per million tokens', () => {
    expect(toMicroUsdPerMTok('0.0000004')).toBe(400_000);
    expect(toMicroUsdPerMTok('0.000000019')).toBe(19_000);
    expect(toMicroUsdPerMTok('0')).toBe(0);
    expect(toMicroUsdPerMTok('-1')).toBeNull();
  });
});

describe('rankCheapestChatModels', () => {
  const ranked = rankCheapestChatModels(parseOpenRouterCatalogue(MODELS_PAYLOAD));

  test('keeps only paid text-output routes declaring both `tools` and `response_format`, cheapest (input + output) first', () => {
    expect(ranked.map((model) => model.id)).toEqual(['vendor/cheapest', 'vendor/middle', 'vendor/expensive']);
  });

  test('drops a route whose id the registry could never hold: a `:variant`, a `~alias`, a free route', () => {
    const ids = ranked.map((model) => model.id);
    expect(ids).not.toContain('vendor/cheapest:batch');
    expect(ids).not.toContain('~vendor/alias-latest');
    expect(ids).not.toContain('vendor/free:free');
  });

  test('drops an unpriced router: a default must have a known price', () => {
    expect(ranked.map((model) => model.id)).not.toContain('openrouter/auto');
  });

  test('drops a route that does not emit text, and one missing either tools or JSON output', () => {
    const ids = ranked.map((model) => model.id);
    expect(ids).not.toContain('vendor/image-only');
    expect(ids).not.toContain('vendor/no-tools');
    expect(ids).not.toContain('vendor/no-json');
  });
});

describe('rankCheapestEmbeddingModels', () => {
  test('keeps paid embedding routes, cheapest input price first', () => {
    const ranked = rankCheapestEmbeddingModels(parseOpenRouterCatalogue(EMBEDDINGS_PAYLOAD));

    expect(ranked.map((model) => model.id)).toEqual(['vendor/embed-small', 'vendor/embed-large']);
  });
});

describe('renderMarkdownTable', () => {
  test('renders one row per model with dollar prices per million tokens and the schema flag', () => {
    const table = renderMarkdownTable(rankCheapestChatModels(parseOpenRouterCatalogue(MODELS_PAYLOAD)).slice(0, 2), 'chat');

    expect(table).toContain('| `vendor/cheapest` | 0.019 | 0.030 | 131,072 | yes |');
    expect(table).toContain('| `vendor/middle` | 0.050 | 0.080 | 32,768 | no |');
    expect(table.split('\n')[0]).toContain('$/1M input');
  });

  test('renders an embedding row with its declared dimensions', () => {
    const table = renderMarkdownTable(rankCheapestEmbeddingModels(parseOpenRouterCatalogue(EMBEDDINGS_PAYLOAD)), 'embedding');

    expect(table).toContain('| `vendor/embed-small` | 0.005 | 512 | 384 |');
    expect(table).toContain('| `vendor/embed-large` | 0.020 | 8,192 | 1536 |');
  });
});
