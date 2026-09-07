import { describe, expect, test } from 'bun:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../schema';
import { isInsideCodeBlock, matchTrigger } from './trigger';

// document-editor: Mention And Slash Menus Are Keyboard-First (the trigger
// half); No Menu Inside A Code Block; Empty And No-Results States (the
// empty-query detection half — a query of '' is a valid match).
describe('matchTrigger', () => {
  test('matches the trigger character at the start of a word with an empty query', () => {
    expect(matchTrigger('Hello @', '@')).toEqual({ from: 6, query: '' });
  });

  test('matches the trigger character with a partial query typed after it', () => {
    expect(matchTrigger('Hello @jan', '@')).toEqual({ from: 6, query: 'jan' });
  });

  test('does not match the trigger character in the middle of a word', () => {
    expect(matchTrigger('email@example', '@')).toBeNull();
  });

  test('does not match once the query contains whitespace', () => {
    expect(matchTrigger('Hello @jane doe', '@')).toBeNull();
  });

  test('does not match a different trigger character', () => {
    expect(matchTrigger('Hello /slash', '@')).toBeNull();
  });

  test('matches the slash trigger at the start of a line', () => {
    expect(matchTrigger('/head', '/')).toEqual({ from: 0, query: 'head' });
  });
});

describe('isInsideCodeBlock', () => {
  test('is true when the selection is inside a code node', () => {
    const doc = schema.node('doc', null, [schema.node('code', { lang: null, meta: null, blockAnchor: null }, schema.text('x'))]);
    const state = EditorState.create({ schema, doc });
    const codeBlockState = state.apply(state.tr.setSelection(TextSelection.near(state.doc.resolve(2))));
    expect(isInsideCodeBlock(codeBlockState)).toBe(true);
  });

  test('is false when the selection is inside a paragraph', () => {
    const doc = schema.node('doc', null, [schema.node('paragraph', { blockAnchor: null }, schema.text('x'))]);
    const state = EditorState.create({ schema, doc });
    expect(isInsideCodeBlock(state)).toBe(false);
  });
});
