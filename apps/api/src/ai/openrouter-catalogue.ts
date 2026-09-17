/**
 * OpenRouter's public catalogue, parsed and ranked by price (docs/TODO.md
 * Finding 2026-09-17 — "Cheap models first"). The owner's rule is that
 * the default model of every AI feature is the cheapest one that passes
 * conformance; this module is how a candidate list is produced from
 * measured prices rather than from a model's reputation.
 *
 * Pure: no network. `GET /api/v1/models` (chat) and
 * `GET /api/v1/embeddings/models` (embeddings) are fetched only by the
 * opt-in `ai:catalogue` CLI (`./openrouter-catalogue-cli.ts`), never by
 * a test. Neither endpoint needs a key, so nothing here touches one.
 *
 * Prices are stored in the registry's own unit — integer micro-USD per
 * million tokens (`packages/core/src/ai/registry.ts`, `ModelPricing`) —
 * so a row from this table can be copied into a registry entry without
 * a second conversion.
 */
import { parseModelId } from '@deep-wiki/core';

export interface CatalogueModel {
  readonly id: string;
  readonly name: string;
  readonly contextLength: number;
  readonly outputModalities: readonly string[];
  readonly supportedParameters: readonly string[];
  /** `null` when OpenRouter reports `-1`: a router whose price depends on where it lands. */
  readonly inputMicroUsdPerMTok: number | null;
  readonly outputMicroUsdPerMTok: number | null;
  /** OpenRouter states an embedding model's dimensions only in prose; `null` when the description does not say. */
  readonly declaredDimensions: number | null;
  readonly isAlias: boolean;
}

const MICRO_USD_PER_MTOK_FACTOR = 1_000_000 * 1_000_000;

/**
 * OpenRouter prices are USD-per-token decimal strings (`"0.0000004"`);
 * the registry wants integer µ$ per MTok. `"-1"` is OpenRouter's marker
 * for "no fixed price" (its `openrouter/auto` routers) and parses to
 * `null` — an unpriced route is never a candidate default.
 */
export function toMicroUsdPerMTok(perTokenUsd: string): number | null {
  if (perTokenUsd === '-1') return null;
  if (!/^\d+(\.\d+)?$/.test(perTokenUsd)) {
    throw new Error(`openrouter catalogue: unparseable price "${perTokenUsd}"`);
  }
  return Math.round(Number(perTokenUsd) * MICRO_USD_PER_MTOK_FACTOR);
}

function readDeclaredDimensions(description: unknown): number | null {
  if (typeof description !== 'string') return null;
  const match = /(\d[\d,]*)[- ]dimension/i.exec(description);
  if (!match) return null;
  return Number(match[1]!.replaceAll(',', ''));
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function parseRow(row: unknown): CatalogueModel {
  if (typeof row !== 'object' || row === null) {
    throw new Error('openrouter catalogue: a model row is not an object');
  }
  const record = row as Record<string, unknown>;
  const pricing = (record.pricing ?? {}) as Record<string, unknown>;
  const architecture = (record.architecture ?? {}) as Record<string, unknown>;

  if (typeof record.id !== 'string') {
    throw new Error('openrouter catalogue: a model row has no string id');
  }

  return {
    id: record.id,
    name: typeof record.name === 'string' ? record.name : record.id,
    contextLength: typeof record.context_length === 'number' ? record.context_length : 0,
    outputModalities: readStringArray(architecture.output_modalities),
    supportedParameters: readStringArray(record.supported_parameters),
    inputMicroUsdPerMTok: toMicroUsdPerMTok(String(pricing.prompt ?? '')),
    outputMicroUsdPerMTok: toMicroUsdPerMTok(String(pricing.completion ?? '0')),
    declaredDimensions: readDeclaredDimensions(record.description),
    isAlias: typeof record.alias_target === 'string',
  };
}

/** Parses either catalogue payload; both share the `{ data: Model[] }` envelope. Throws on a shape it does not recognise. */
export function parseOpenRouterCatalogue(payload: unknown): readonly CatalogueModel[] {
  if (typeof payload !== 'object' || payload === null || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error('openrouter catalogue: payload is not `{ data: [...] }`');
  }
  return ((payload as { data: unknown[] }).data).map(parseRow);
}

/** The registry's slug rule (`parseModelId`) is the arbiter: a `:variant` or `~alias` id can never be registered. */
function isRegistrableId(id: string): boolean {
  return parseModelId(`openrouter:${id}`).ok;
}

interface PricedModel extends CatalogueModel {
  readonly inputMicroUsdPerMTok: number;
  readonly outputMicroUsdPerMTok: number;
}

function isPaid(model: CatalogueModel): model is PricedModel {
  return (
    model.inputMicroUsdPerMTok !== null &&
    model.outputMicroUsdPerMTok !== null &&
    (model.inputMicroUsdPerMTok > 0 || model.outputMicroUsdPerMTok > 0)
  );
}

/**
 * Paid, registrable, text-emitting routes that declare both `tools` and
 * `response_format`, cheapest first by input + output price. Free routes
 * are excluded on purpose: they are rate-limited and may train on
 * prompts, so they cannot be a product default.
 */
export function rankCheapestChatModels(models: readonly CatalogueModel[]): readonly PricedModel[] {
  return models
    .filter(isPaid)
    .filter(
      (model) =>
        !model.isAlias &&
        isRegistrableId(model.id) &&
        model.outputModalities.includes('text') &&
        model.supportedParameters.includes('tools') &&
        model.supportedParameters.includes('response_format'),
    )
    .toSorted(
      (a, b) => a.inputMicroUsdPerMTok + a.outputMicroUsdPerMTok - (b.inputMicroUsdPerMTok + b.outputMicroUsdPerMTok),
    );
}

/** Paid, registrable embedding routes, cheapest input price first. */
export function rankCheapestEmbeddingModels(models: readonly CatalogueModel[]): readonly PricedModel[] {
  return models
    .filter(isPaid)
    .filter((model) => !model.isAlias && isRegistrableId(model.id) && model.outputModalities.includes('embeddings'))
    .toSorted((a, b) => a.inputMicroUsdPerMTok - b.inputMicroUsdPerMTok);
}

function dollarsPerMTok(microUsdPerMTok: number): string {
  return (microUsdPerMTok / 1_000_000).toFixed(3);
}

function withThousands(value: number): string {
  return value.toLocaleString('en-US');
}

/** A GitHub-flavoured markdown table, ready to paste into a `docs/TODO.md` Finding. */
export function renderMarkdownTable(models: readonly PricedModel[], kind: 'chat' | 'embedding'): string {
  if (kind === 'chat') {
    const header = '| Model | $/1M input | $/1M output | Context | `structured_outputs` |\n| --- | ---: | ---: | ---: | --- |';
    const rows = models.map(
      (model) =>
        `| \`${model.id}\` | ${dollarsPerMTok(model.inputMicroUsdPerMTok)} | ${dollarsPerMTok(model.outputMicroUsdPerMTok)} | ${withThousands(model.contextLength)} | ${model.supportedParameters.includes('structured_outputs') ? 'yes' : 'no'} |`,
    );
    return [header, ...rows].join('\n');
  }

  const header = '| Model | $/1M input | Context | Dimensions (declared) |\n| --- | ---: | ---: | ---: |';
  const rows = models.map(
    (model) =>
      `| \`${model.id}\` | ${dollarsPerMTok(model.inputMicroUsdPerMTok)} | ${withThousands(model.contextLength)} | ${model.declaredDimensions ?? 'not stated'} |`,
  );
  return [header, ...rows].join('\n');
}
