/**
 * The non-disclosure helper is itself a test-only guard rail, so it needs
 * its own red-first coverage: a scan that silently skips a channel is the
 * same defect class as the leak it exists to catch. Headers are a wire
 * channel like the body, and until this file existed nothing proved the
 * helper looked at them.
 */
import { describe, expect, test } from 'bun:test';
import { expectNoDisclosure } from './expect-no-disclosure';

const HIDDEN_ID = '11111111-2222-4333-8444-555555555555';

describe('expectNoDisclosure — body channel', () => {
  test('a hidden id anywhere in the serialised body throws', () => {
    expect(() => expectNoDisclosure({ nested: [{ ref: HIDDEN_ID }] }, { id: HIDDEN_ID }, new Headers())).toThrow(/id/);
  });

  test('a hidden slug and title are caught too', () => {
    expect(() => expectNoDisclosure({ s: 'hidden-slug' }, { id: HIDDEN_ID, slug: 'hidden-slug' }, new Headers())).toThrow(/slug/);
    expect(() => expectNoDisclosure({ t: 'Secret Title' }, { id: HIDDEN_ID, title: 'Secret Title' }, new Headers())).toThrow(/title/);
  });

  test('a clean body and clean headers pass', () => {
    expect(() =>
      expectNoDisclosure({ indicators: [] }, { id: HIDDEN_ID, slug: 'hidden-slug', title: 'Secret Title' }, new Headers({ 'content-type': 'application/json' })),
    ).not.toThrow();
  });
});

describe('expectNoDisclosure — header channel', () => {
  test('a hidden id in a header value throws, even with a clean body', () => {
    const headers = new Headers({ 'x-node-id': HIDDEN_ID });
    expect(() => expectNoDisclosure({ indicators: [] }, { id: HIDDEN_ID }, headers)).toThrow(/header/);
  });

  test('a hidden id in a header name throws', () => {
    const headers = new Headers({ [`x-page-${HIDDEN_ID}`]: '1' });
    expect(() => expectNoDisclosure({ indicators: [] }, { id: HIDDEN_ID }, headers)).toThrow(/header/);
  });

  test('a hidden slug or title in a header throws', () => {
    expect(() =>
      expectNoDisclosure({}, { id: HIDDEN_ID, slug: 'hidden-slug' }, new Headers({ 'x-slug': 'hidden-slug' })),
    ).toThrow(/header/);
    expect(() =>
      expectNoDisclosure({}, { id: HIDDEN_ID, title: 'Secret Title' }, new Headers({ 'x-title': 'Secret Title' })),
    ).toThrow(/header/);
  });

  // The channel the audit named: a comment count is neither an id, a slug
  // nor a title, so it needs to be nameable as a forbidden value.
  test('an explicitly forbidden value leaked through a header throws', () => {
    const headers = new Headers({ 'x-comment-count': '3' });
    expect(() => expectNoDisclosure({ indicators: [] }, { id: HIDDEN_ID, values: ['x-comment-count'] }, headers)).toThrow(/header/);
  });

  test('a plain header record is accepted as well as a Headers instance', () => {
    expect(() => expectNoDisclosure({}, { id: HIDDEN_ID }, { 'x-node-id': HIDDEN_ID })).toThrow(/header/);
  });
});
