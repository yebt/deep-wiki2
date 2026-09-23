/**
 * The `savePage()` refusal mapping, asserted on its own rather than through
 * a route: three of the four refusals are races or already-closed holes that
 * no route test can provoke on demand, and the one that a route *could*
 * provoke is the one that used to reach a commenter as a 500. Driving the
 * mapping directly is the only way to state that every refusal `savePage()`
 * declares has an answer, and that nothing else does.
 */
import { describe, expect, test } from 'bun:test';
import { DeadAnchorError, NotCanonicalError, PageNotFoundError, StaleContentError } from '@deep-wiki/db';
import { savePageRefusal } from './save-page-refusal';

const NODE_ID = '11111111-2222-3333-4444-555555555555';

describe('savePageRefusal', () => {
  test('a stale save is a 409 in the caller\'s terms', () => {
    expect(savePageRefusal(new StaleContentError(NODE_ID))).toEqual({
      status: 409,
      body: { error: 'stale content: reload before saving again' },
    });
  });

  test('a non-canonical document is a 409 carrying the normalised form to adopt', () => {
    const refusal = savePageRefusal(new NotCanonicalError('Normalised.\n'));

    expect(refusal).toEqual({ status: 409, body: { error: 'not canonical', canonical: 'Normalised.\n' } });
  });

  test('a reintroduced dead anchor is a 409 carrying the corrected document and the offending ids', () => {
    const error = new DeadAnchorError(NODE_ID, [{ id: 'DEADAAAAAA', status: 'tombstoned' }], 'A paragraph.\n');

    expect(savePageRefusal(error)).toEqual({
      status: 409,
      body: { error: 'dead anchor', corrected: 'A paragraph.\n', anchors: [{ id: 'DEADAAAAAA', status: 'tombstoned' }] },
    });
  });

  test('a page that vanished under the save answers exactly as an absent page does', () => {
    // Byte-identical to the 404 both routes give an unknown page: a trashed
    // page must answer like one that never existed (trash-non-disclosure).
    expect(savePageRefusal(new PageNotFoundError(NODE_ID))).toEqual({ status: 404, body: { error: 'not found' } });
  });

  test('anything else is not a refusal and stays a 500 for the caller to rethrow', () => {
    expect(savePageRefusal(new Error('the connection dropped'))).toBeNull();
    expect(savePageRefusal(new TypeError('undefined is not a function'))).toBeNull();
    expect(savePageRefusal('not an error at all')).toBeNull();
  });
});
