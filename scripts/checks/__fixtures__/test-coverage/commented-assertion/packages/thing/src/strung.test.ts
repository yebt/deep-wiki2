import { test } from 'bun:test';
import { help } from './strung';

const HINT = 'call expect(x) here';

/* and a block comment: assert(help()) */
test('placeholder', () => {
  help();
  void HINT;
});
