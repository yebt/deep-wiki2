import { parseOpenRouterCatalogue, rankCheapestChatModels, rankCheapestEmbeddingModels, renderMarkdownTable } from './openrouter-catalogue';

/**
 * `bun run -F @deep-wiki/api ai:catalogue [--top N] [--from <models.json> <embeddings.json>]`
 *
 * Opt-in, real network, **no key** — OpenRouter's two catalogue endpoints
 * are public. Prints the cheapest chat routes that declare `tools` and
 * `response_format`, and the cheapest embedding routes, as two markdown
 * tables to paste into a `docs/TODO.md` Finding. Never part of
 * `bun run test` (its test feeds it saved payloads through `--from`).
 */
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings/models';

interface Args {
  readonly top: number;
  readonly from: readonly [string, string] | null;
}

function parseArgs(argv: readonly string[]): Args {
  let top = 15;
  let from: readonly [string, string] | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--top') {
      top = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--from') {
      const models = argv[index + 1];
      const embeddings = argv[index + 2];
      if (!models || !embeddings) {
        throw new Error('--from needs two paths: <models.json> <embeddings.json>');
      }
      from = [models, embeddings];
      index += 2;
    }
  }
  if (!Number.isInteger(top) || top <= 0) {
    throw new Error('--top must be a positive integer');
  }
  return { top, from };
}

async function loadPayload(source: string): Promise<unknown> {
  if (source.startsWith('https://')) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${source}`);
    }
    return response.json();
  }
  return Bun.file(source).json();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const [modelsSource, embeddingsSource] = args.from ?? [MODELS_URL, EMBEDDINGS_URL];

  const chat = rankCheapestChatModels(parseOpenRouterCatalogue(await loadPayload(modelsSource))).slice(0, args.top);
  const embeddings = rankCheapestEmbeddingModels(parseOpenRouterCatalogue(await loadPayload(embeddingsSource))).slice(0, args.top);

  console.log(`ai:catalogue: cheapest ${chat.length} chat routes declaring tools + response_format (source: ${modelsSource})`);
  console.log(renderMarkdownTable(chat, 'chat'));
  console.log('');
  console.log(`ai:catalogue: cheapest ${embeddings.length} embedding routes (source: ${embeddingsSource})`);
  console.log(renderMarkdownTable(embeddings, 'embedding'));
}

if (import.meta.main) {
  try {
    await main();
  } catch (caught) {
    console.error(`ai:catalogue: ${caught instanceof Error ? caught.message : String(caught)}`);
    process.exit(1);
  }
}
