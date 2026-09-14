import { expect, test } from 'bun:test';
import { tilde } from '~/tilde';
import { at } from '@/at';
import { rootLevel } from '~~/root-level';
import { hashed } from '#lib/hashed';

test('every alias form is evidence, exactly as a relative path is', () => {
  expect(tilde()).toBe(1);
  expect(at()).toBe(2);
  expect(rootLevel()).toBe(4);
  expect(hashed()).toBe(3);
});
