import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrefix } from './prefix';
import type { StablePrefixInput } from './prefix';

const SEARCH_TOOL = JSON.stringify({ name: 'search', description: 'Search the wiki', parameters: { type: 'object' } });
const CREATE_PAGE_TOOL = JSON.stringify({ name: 'create_page', description: 'Create a page' });

function fixedInput(overrides: Partial<StablePrefixInput> = {}): StablePrefixInput {
  return {
    tools: [SEARCH_TOOL, CREATE_PAGE_TOOL],
    system: 'You are the deep-wiki assistant.',
    teamRulePacks: ['Always cite sources.'],
    document: 'The quarterly report content.',
    question: 'Summarise the key findings.',
    ...overrides,
  };
}

describe('buildPrefix — determinism', () => {
  test('assembling the same input twice produces deep-equal output', () => {
    const first = buildPrefix(fixedInput());
    const second = buildPrefix(fixedInput());

    expect(first).toEqual(second);
  });
});

describe('buildPrefix — shuffle-invariance', () => {
  test('shuffling the tool input array produces byte-identical serialized output', () => {
    const inOrder = buildPrefix(fixedInput({ tools: [SEARCH_TOOL, CREATE_PAGE_TOOL] }));
    const shuffled = buildPrefix(fixedInput({ tools: [CREATE_PAGE_TOOL, SEARCH_TOOL] }));

    expect(shuffled.text).toBe(inOrder.text);
    expect(shuffled.hash).toBe(inOrder.hash);
  });
});

describe('buildPrefix — fixed stable-to-volatile ordering (prompt-assembly spec)', () => {
  test('tools appear before system, system before rule packs, rule packs before document, document before question', () => {
    const prefix = buildPrefix(fixedInput());

    const toolsIndex = prefix.text.indexOf('search');
    const systemIndex = prefix.text.indexOf('You are the deep-wiki assistant.');
    const rulePackIndex = prefix.text.indexOf('Always cite sources.');
    const documentIndex = prefix.text.indexOf('The quarterly report content.');
    const questionIndex = prefix.text.indexOf('Summarise the key findings.');

    expect(toolsIndex).toBeGreaterThanOrEqual(0);
    expect(toolsIndex).toBeLessThan(systemIndex);
    expect(systemIndex).toBeLessThan(rulePackIndex);
    expect(rulePackIndex).toBeLessThan(documentIndex);
    expect(documentIndex).toBeLessThan(questionIndex);
  });

  test('cacheBoundary marks the end of the stable segment — no volatile content precedes it', () => {
    const prefix = buildPrefix(fixedInput());
    const stableSlice = prefix.text.slice(0, prefix.cacheBoundary);

    expect(stableSlice).not.toContain('The quarterly report content.');
    expect(stableSlice).not.toContain('Summarise the key findings.');
  });

  test('the hash covers only the stable segment — two calls differing only in volatile content hash identically', () => {
    const first = buildPrefix(fixedInput({ document: 'Document A', question: 'Question A' }));
    const second = buildPrefix(fixedInput({ document: 'Document B', question: 'Question B' }));

    expect(second.hash).toBe(first.hash);
    expect(second.text).not.toBe(first.text);
  });
});

describe('buildPrefix — nondeterminism in the stable prefix is a defect', () => {
  test('a tool object with unsorted keys still assembles identically to one with sorted keys', () => {
    const unsorted = JSON.stringify({ description: 'Search the wiki', name: 'search', parameters: { type: 'object' } });
    const sorted = SEARCH_TOOL;

    const first = buildPrefix(fixedInput({ tools: [unsorted, CREATE_PAGE_TOOL] }));
    const second = buildPrefix(fixedInput({ tools: [sorted, CREATE_PAGE_TOOL] }));

    expect(first.hash).toBe(second.hash);
  });
});

const FIXTURES_DIR = join(import.meta.dir, '__fixtures__', 'rule-packs');

describe('golden file per rule-pack fixture (a prefix change is a visible review diff)', () => {
  for (const fixtureName of ['engineering-handbook', 'writing-style']) {
    test(`${fixtureName}: stable segment matches its checked-in golden`, () => {
      const rulePackContent = readFileSync(join(FIXTURES_DIR, `${fixtureName}.txt`), 'utf8');
      const golden = readFileSync(join(FIXTURES_DIR, `${fixtureName}.golden.txt`), 'utf8');

      const prefix = buildPrefix(
        fixedInput({ teamRulePacks: [rulePackContent], document: '', question: '' }),
      );

      expect(prefix.text.slice(0, prefix.cacheBoundary)).toBe(golden);
    });
  }
});
