/**
 * The structured-output degradation ladder (design.md — "Capability
 * registry and structured-output degradation"). Pure and total: the
 * runtime never skips a rung and never silently runs below the declared
 * level (D12). `degrade('none')` returns `null` — there is nothing below
 * the floor to fall back to.
 */
import type { StructuredOutputLevel } from './registry';

const LADDER: readonly StructuredOutputLevel[] = ['schema', 'tool-call', 'prompted', 'none'];

export function degrade(level: StructuredOutputLevel): StructuredOutputLevel | null {
  const index = LADDER.indexOf(level);
  const next = LADDER[index + 1];
  return next ?? null;
}
