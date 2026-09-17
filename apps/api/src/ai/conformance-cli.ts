import { parseModelId, Secret } from '@deep-wiki/core';
import { resolveChatModel } from './gateway/resolve-chat-model';
import { runConformanceSuite } from './conformance';

/**
 * `bun run -F @deep-wiki/api ai:conformance`
 *
 * Opt-in, real network, real keys, **spends money** — never part of
 * `bun run test` (design.md — "Testing strategy", "Opt-in, outside bun
 * run test"). Runs the fixed conformance schema through every wired
 * model whose key is available in the environment, at its
 * registry-declared `structuredOutput` level, and exits non-zero the
 * moment any model's declared level was not honored.
 *
 * One env var per provider, matching `ai:probe`'s convention: a
 * provider with no key configured is skipped and reported, never
 * silently assumed to pass.
 */
const CASES: readonly { readonly modelId: string; readonly envVar: string }[] = [
  { modelId: 'anthropic:claude-3-5-sonnet-20241022', envVar: 'AI_CONFORMANCE_ANTHROPIC_KEY' },
  { modelId: 'openai:gpt-4o', envVar: 'AI_CONFORMANCE_OPENAI_KEY' },
  { modelId: 'google:gemini-1.5-pro', envVar: 'AI_CONFORMANCE_GOOGLE_KEY' },
  { modelId: 'deepseek:deepseek-chat', envVar: 'AI_CONFORMANCE_DEEPSEEK_KEY' },
  // Cheapest first (docs/TODO.md Finding 2026-09-17 — "Cheap models first"); the 70b route is the upgrade.
  { modelId: 'openrouter:mistralai/mistral-nemo', envVar: 'AI_CONFORMANCE_OPENROUTER_KEY' },
  { modelId: 'openrouter:meta-llama/llama-3.1-8b-instruct', envVar: 'AI_CONFORMANCE_OPENROUTER_KEY' },
  { modelId: 'openrouter:qwen/qwen3-30b-a3b-instruct-2507', envVar: 'AI_CONFORMANCE_OPENROUTER_KEY' },
  { modelId: 'openrouter:meta-llama/llama-3.1-70b-instruct', envVar: 'AI_CONFORMANCE_OPENROUTER_KEY' },
];

async function main(): Promise<void> {
  const runnable = CASES.filter((testCase) => process.env[testCase.envVar]);
  const skipped = CASES.filter((testCase) => !process.env[testCase.envVar]);

  for (const testCase of skipped) {
    console.log(`ai:conformance: ${testCase.modelId} — skipped (set ${testCase.envVar})`);
  }

  const results = await runConformanceSuite(
    runnable.flatMap((testCase) => {
      const modelRef = parseModelId(testCase.modelId);
      if (!modelRef.ok) {
        // Every entry in CASES above is a literal, valid "<provider>:<slug>" —
        // this branch exists only so a future typo fails loudly instead of
        // silently skipping a provider `ai:conformance` was meant to cover.
        console.error(`ai:conformance: "${testCase.modelId}" is not a valid model id — check CASES in this file`);
        process.exit(1);
      }
      return [{ modelId: testCase.modelId, chatModel: resolveChatModel(modelRef.value.provider), key: new Secret(process.env[testCase.envVar]!) }];
    }),
  );

  let allMatched = true;
  for (const result of results) {
    console.log(
      `ai:conformance: ${result.modelId} (declared "${result.declaredLevel}") — matched=${result.matched} (${result.detail}) — rungs=${result.rungs} tokens=${result.usage.inputTokens}/${result.usage.outputTokens} cost=${result.costMicroUsd}µ$ elapsed=${result.elapsedMs}ms`,
    );
    if (!result.matched) allMatched = false;
  }

  if (!allMatched) {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
