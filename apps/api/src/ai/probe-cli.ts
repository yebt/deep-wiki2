import { Secret } from '@deep-wiki/core';
import { probeGoogleEmbeddings, probeOpenAiEmbeddings, probeOpenRouterEmbeddings, type EmbeddingProbeOutcome } from './probe';

/**
 * `bun run -F @deep-wiki/api ai:probe`
 *
 * Opt-in, real network, real keys — never part of `bun run test`
 * (design.md — "Testing strategy", "Opt-in, outside bun run test"). Reads
 * one API key per provider from the environment; a provider whose key is
 * absent is reported as "unknown — no key available in this session",
 * never silently skipped and never assumed unsupported. An unrun probe
 * is unknown, not a claim about the provider (proposal — "Escalated Open
 * Question").
 *
 * Prints one line per provider so the output can be pasted verbatim into
 * a `docs/TODO.md` Finding (task 18.2) — it never prints the key itself.
 */
type Outcome = EmbeddingProbeOutcome | { readonly provider: 'openai' | 'google' | 'openrouter'; readonly supported: 'unknown'; readonly detail: string };

async function probeOrUnknown(
  provider: 'openai' | 'google' | 'openrouter',
  envVar: string,
  run: (key: Secret<string>) => Promise<EmbeddingProbeOutcome>,
): Promise<Outcome> {
  const raw = process.env[envVar];
  if (!raw) {
    return { provider, supported: 'unknown', detail: `no key available in this session (set ${envVar})` };
  }
  return run(new Secret(raw));
}

async function main(): Promise<void> {
  const outcomes = await Promise.all([
    probeOrUnknown('openai', 'AI_PROBE_OPENAI_KEY', (key) => probeOpenAiEmbeddings(key)),
    probeOrUnknown('google', 'AI_PROBE_GOOGLE_KEY', (key) => probeGoogleEmbeddings(key)),
    probeOrUnknown('openrouter', 'AI_PROBE_OPENROUTER_KEY', (key) => probeOpenRouterEmbeddings(key)),
  ]);

  for (const outcome of outcomes) {
    console.log(`ai:probe: ${outcome.provider} embeddings — supported=${outcome.supported} (${outcome.detail})`);
  }
}

if (import.meta.main) {
  await main();
}
