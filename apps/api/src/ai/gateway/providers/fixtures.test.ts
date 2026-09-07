/**
 * Scrubber test (design.md — "Testing strategy" — "a scrubber test
 * asserts no fixture file contains an API-key-shaped string"). Every
 * recorded fixture in `__fixtures__/` is a synthetic response built by
 * hand for this suite — none of them was ever recorded against a real
 * account — but the assertion protects the file class going forward: a
 * future re-recording against a real provider must scrub its key before
 * it is committed.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';

const FIXTURES_DIR = join(import.meta.dir, '__fixtures__');

/**
 * Shapes real provider keys take: `sk-...` (OpenAI, DeepSeek, OpenRouter),
 * `sk-ant-...` (Anthropic), and a bare Google API key (`AIza...`, 39
 * chars total). Deliberately broad — a false positive here just means
 * tightening a fixture's prose, never a fixture silently passing with a
 * real credential inside it.
 */
const API_KEY_SHAPED_PATTERN = /\bsk-(ant-)?[A-Za-z0-9_-]{16,}\b|\bAIza[A-Za-z0-9_-]{35}\b/;

describe('provider fixtures never contain an API-key-shaped string', () => {
  const files = readdirSync(FIXTURES_DIR);

  for (const file of files) {
    test(`${file} is clean`, () => {
      const content = readFileSync(join(FIXTURES_DIR, file), 'utf8');
      expect(API_KEY_SHAPED_PATTERN.test(content)).toBe(false);
    });
  }
});
