import { describe, expect, test } from 'vitest';
import { formatRevisionDate } from './format-revision-date';

/**
 * "When" a revision was saved (docs/UI-CHECKLIST.md §3, "Success" wants a
 * confirmation the user can act on, not a bare timestamp).
 */
describe('formatRevisionDate', () => {
  test('renders an ISO timestamp as a fixed-locale, fixed-timezone absolute string', () => {
    expect(formatRevisionDate('2026-09-08T15:45:00.000Z')).toBe('Sep 8, 2026, 3:45 PM UTC');
  });

  test('formats a different timestamp to a different string — not a hardcoded return', () => {
    expect(formatRevisionDate('2026-01-01T00:00:00.000Z')).toBe('Jan 1, 2026, 12:00 AM UTC');
  });

  test('throws on an unparsable timestamp rather than rendering "Invalid Date"', () => {
    expect(() => formatRevisionDate('not-a-date')).toThrow();
  });
});
