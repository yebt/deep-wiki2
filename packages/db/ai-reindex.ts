import postgres from 'postgres';
import { completeReindex, startReindex } from './src/ai/reindex';

/**
 * `bun run -F @deep-wiki/db ai:reindex start --workspace <id> --provider <p> --model <m> --dimensions <d>`
 * `bun run -F @deep-wiki/db ai:reindex complete --job <id>`
 *
 * Creates (or completes) a tracked reindex job — the only way a
 * workspace's active `(embedding_model, dimensions)` pair ever changes
 * (embedding-index-integrity spec). Never called automatically by a
 * settings change; an operator or a future settings route invokes it
 * explicitly.
 */
function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ai:reindex: DATABASE_URL is not set');
    process.exit(1);
  }

  const [command, ...rest] = process.argv.slice(2);
  const sql = postgres(url);

  try {
    if (command === 'start') {
      const workspaceId = readFlag(rest, 'workspace');
      const provider = readFlag(rest, 'provider');
      const model = readFlag(rest, 'model');
      const dimensions = Number(readFlag(rest, 'dimensions') ?? '1536');

      if (!workspaceId || !provider || !model) {
        console.error('ai:reindex start: --workspace, --provider and --model are required');
        process.exit(1);
      }

      const result = await startReindex(sql, { workspaceId, toProvider: provider, toModel: model, toDimensions: dimensions });
      if (!result.ok) {
        console.error(`ai:reindex start: ${result.error.reason}`);
        process.exit(1);
      }
      console.log(`ai:reindex start: job ${result.value.jobId} queued (from ${result.value.fromModel ?? 'none'} to ${model})`);
      return;
    }

    if (command === 'complete') {
      const jobId = readFlag(rest, 'job');
      if (!jobId) {
        console.error('ai:reindex complete: --job is required');
        process.exit(1);
      }

      const result = await completeReindex(sql, jobId);
      if (!result.ok) {
        console.error(`ai:reindex complete: ${result.error.reason}`);
        process.exit(1);
      }
      console.log(`ai:reindex complete: job ${jobId} completed, active generation flipped`);
      return;
    }

    console.error('ai:reindex: expected a "start" or "complete" subcommand');
    process.exit(1);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
