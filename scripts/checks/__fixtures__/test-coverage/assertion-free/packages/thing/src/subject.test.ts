import { test } from 'bun:test';
import { subject } from './subject';

test('runs without asserting anything', () => {
  subject();
});
