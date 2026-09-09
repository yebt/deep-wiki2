import { test } from 'bun:test';
import { bar } from './real';

// TODO: expect(bar(1)).toBe(2) once fixture data lands
test('placeholder', () => {
  bar(1);
});
