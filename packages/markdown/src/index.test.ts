import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './index';

const FIXTURES_DIR = join(import.meta.dir, '..', 'fixtures', 'modelled');

test('parse() turns a heading fixture into the expected mdast', () => {
  const markdown = readFileSync(join(FIXTURES_DIR, 'heading.md'), 'utf8');

  const root = parse(markdown);

  expect(root.type).toBe('root');
  expect(root.children).toHaveLength(1);

  const heading = root.children[0];
  expect(heading?.type).toBe('heading');
  if (heading?.type === 'heading') {
    expect(heading.depth).toBe(1);
    expect(heading.children).toHaveLength(1);
    expect(heading.children[0]).toMatchObject({ type: 'text', value: 'Hello, deep-wiki' });
  }
});
