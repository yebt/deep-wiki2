/**
 * `bun run -F @deep-wiki/api ai:catalogue` reading from files. The
 * network path (no arguments) is opt-in and never runs here; `--from`
 * feeds the same renderer two saved payloads so the CLI's output shape
 * is under test without a single request leaving the machine.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const CLI = join(import.meta.dir, 'openrouter-catalogue-cli.ts');

function chat(id: string, prompt: string, completion: string) {
  return {
    id,
    name: id,
    context_length: 131072,
    architecture: { output_modalities: ['text'] },
    pricing: { prompt, completion },
    supported_parameters: ['tools', 'response_format', 'structured_outputs'],
  };
}

describe('ai:catalogue --from <models.json> <embeddings.json>', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-catalogue-'));
  const modelsPath = join(dir, 'models.json');
  const embeddingsPath = join(dir, 'embeddings.json');
  writeFileSync(
    modelsPath,
    JSON.stringify({ data: [chat('vendor/pricey', '0.000001', '0.000002'), chat('vendor/cheap', '0.00000001', '0.00000002')] }),
  );
  writeFileSync(
    embeddingsPath,
    JSON.stringify({
      data: [
        {
          id: 'vendor/embed',
          name: 'embed',
          context_length: 512,
          description: 'A 768-dimensional model.',
          architecture: { output_modalities: ['embeddings'] },
          pricing: { prompt: '0.000000005', completion: '0' },
          supported_parameters: [],
        },
      ],
    }),
  );

  const result = Bun.spawnSync(['bun', 'run', CLI, '--from', modelsPath, embeddingsPath, '--top', '1'], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = result.stdout.toString();

  test('exits cleanly', () => {
    expect(result.exitCode).toBe(0);
  });

  test('prints the cheapest chat models, honouring --top', () => {
    expect(stdout).toContain('| `vendor/cheap` | 0.010 | 0.020 |');
    expect(stdout).not.toContain('vendor/pricey');
  });

  test('prints the cheapest embedding models', () => {
    expect(stdout).toContain('| `vendor/embed` | 0.005 | 512 | 768 |');
  });
});

describe('ai:catalogue with a malformed payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dw-catalogue-bad-'));
  const badPath = join(dir, 'bad.json');
  writeFileSync(badPath, JSON.stringify({ models: [] }));

  const result = Bun.spawnSync(['bun', 'run', CLI, '--from', badPath, badPath], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  test('exits non-zero and names the problem', () => {
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain('ai:catalogue');
  });
});
