/**
 * Stable prompt prefix assembly (design.md — "Prompt assembly — what must
 * hold for the prefix to stay stable"; prompt-assembly spec). The fixed
 * order is tools -> system -> team rule packs -> (cache boundary) ->
 * document -> question, per SPECS §8.8. `hash` is computed only over the
 * stable segment, so two calls differing only in volatile content
 * (document/question) hash identically — this is what makes `prefix_hash`
 * on `ai_usage_events` (D19) an attributable signal of prefix drift rather
 * than noise from the user's own question.
 *
 * Every field here is `string` or `readonly string[]`: no `Date`, no
 * uuid, no `updated_at`. A rule pack contributes its checked-in content
 * only, never its own metadata — a timestamp entering this type is a
 * defect the type itself makes impossible to express (D18).
 */

export interface StablePrefixInput {
  /** Each element: a JSON-serialized tool definition, minimally `{ "name": string, ... }`. */
  readonly tools: readonly string[];
  /** Checked-in system instructions. */
  readonly system: string;
  /** Each element: one team rule pack's checked-in content. */
  readonly teamRulePacks: readonly string[];
  /** Volatile — excluded from `hash`, placed after the cache boundary. */
  readonly document: string;
  /** Volatile — excluded from `hash`, placed last. */
  readonly question: string;
}

export interface StablePrefix {
  readonly text: string;
  readonly hash: string;
  readonly cacheBoundary: number;
}

interface ToolLike {
  readonly name: string;
  readonly [key: string]: unknown;
}

/**
 * Deterministic JSON serialization: object keys sorted, no incidental
 * whitespace. Applied to each tool definition so a source that varies
 * only in key order or formatting never produces a different byte
 * sequence (prompt-assembly spec — "Nondeterminism ... is a defect").
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${canonicalJson(val)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Sorts by `name` so shuffling the input array never changes the
 * serialized output (prompt-assembly spec — "Deterministic Tool
 * Ordering").
 */
function canonicalizeTools(tools: readonly string[]): string {
  const parsed: ToolLike[] = tools.map((raw) => JSON.parse(raw) as ToolLike);
  const sorted = [...parsed].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return sorted.map((tool) => canonicalJson(tool)).join('\n');
}

/**
 * Fast, deterministic, non-cryptographic hash for prefix-drift
 * observability (`prefix_hash`, D19). Collision resistance is not
 * required — only that identical input always produces identical output.
 * Implemented in pure JS (FNV-1a, 32-bit) rather than reaching for
 * `node:crypto` or a Bun-specific global, so `packages/core` keeps
 * importing nothing at all (core-purity.ts).
 */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const SECTION_SEPARATOR = '\n\n---\n\n';
const STABLE_VOLATILE_SEPARATOR = '\n\n===\n\n';

export function buildPrefix(input: StablePrefixInput): StablePrefix {
  const toolsSection = canonicalizeTools(input.tools);
  const rulePacksSection = input.teamRulePacks.join(SECTION_SEPARATOR);

  const stableText = [toolsSection, input.system, rulePacksSection].join(SECTION_SEPARATOR);
  const volatileText = [input.document, input.question].join(SECTION_SEPARATOR);

  const text = `${stableText}${STABLE_VOLATILE_SEPARATOR}${volatileText}`;

  return {
    text,
    hash: fnv1aHex(stableText),
    cacheBoundary: stableText.length,
  };
}
