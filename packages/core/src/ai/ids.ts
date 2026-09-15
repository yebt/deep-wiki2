/**
 * Provider and model identity (design.md — "The provider abstraction").
 * `ModelRef` is produced only by `parseModelId`; a raw user-supplied
 * string never reaches a client factory. `providerId` is a closed union
 * and `slug` is restricted to a safe charset with explicit refusals for
 * a URL scheme, a parent-directory traversal segment, or whitespace —
 * the three shapes a routing-injection attempt would need (design.md —
 * Threat Matrix, "Routing — model selection").
 */
import { err, ok, type Result } from '../result';

export type ProviderId = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'openrouter' | 'local';

const PROVIDER_IDS: ReadonlySet<string> = new Set<ProviderId>([
  'anthropic',
  'openai',
  'google',
  'deepseek',
  'openrouter',
  'local',
]);

export interface ModelRef {
  readonly provider: ProviderId;
  readonly slug: string;
}

export type InvalidModelIdReason = 'malformed' | 'unknown-provider' | 'invalid-slug';

export interface InvalidModelId {
  readonly reason: InvalidModelIdReason;
  readonly raw: string;
}

/** 1-97 chars, lowercase alnum plus `. _ / -`, never starting with one of those separators. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,96}$/;

function isSafeSlug(slug: string): boolean {
  if (/\s/.test(slug)) return false;
  if (slug.includes('..')) return false;
  if (slug.includes('://')) return false;
  return SLUG_PATTERN.test(slug);
}

function isProviderId(value: string): value is ProviderId {
  return PROVIDER_IDS.has(value);
}

/**
 * Parses `<providerId>:<slug>`. Refuses (never throws) a raw string with
 * no separator, an unregistered `providerId`, or a `slug` embedding a URL
 * scheme, a `..` traversal segment, or whitespace.
 */
export function parseModelId(raw: string): Result<ModelRef, InvalidModelId> {
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    return err({ reason: 'malformed', raw });
  }

  const providerId = raw.slice(0, separatorIndex);
  const slug = raw.slice(separatorIndex + 1);

  if (!isProviderId(providerId)) {
    return err({ reason: 'unknown-provider', raw });
  }

  if (!isSafeSlug(slug)) {
    return err({ reason: 'invalid-slug', raw });
  }

  return ok({ provider: providerId, slug });
}
