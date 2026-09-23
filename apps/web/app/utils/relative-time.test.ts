import { describe, expect, test } from 'vitest';
import { formatRelativeTime } from './relative-time';
import { formatRevisionDate } from './format-revision-date';

/**
 * The relative instant a conversation shows (owner request, 2026-09-23:
 * the thread panel must read as a conversation, and a conversation says
 * "2 hours ago", not "Sep 23, 2026, 4:07 PM GMT-5").
 *
 * docs/UI-CHECKLIST.md §4.11 binds every rendered time, and its amended
 * clause is what these tests hold: a relative string is the same string in
 * every zone by construction, so the zone-naming requirement moves to the
 * absolute form that stands beside it — the `<time datetime>` attribute and
 * the title a reader hovers or focuses. The two-zone test §4.11 requires is
 * therefore made against that absolute form, which is the only half of the
 * pair that *can* differ between two readers.
 */
const NOW = new Date('2026-09-23T18:00:00.000Z');

describe('formatRelativeTime', () => {
  test('an instant seconds old reads as just now, in either direction across a skewed clock', () => {
    expect(formatRelativeTime('2026-09-23T17:59:31.000Z', NOW)).toBe('just now');
    // A client clock a few seconds behind the server's must not say "in 20
    // seconds" about a comment the person has just posted.
    expect(formatRelativeTime('2026-09-23T18:00:20.000Z', NOW)).toBe('just now');
  });

  test('minutes, hours and days step through the units, singular and plural', () => {
    expect(formatRelativeTime('2026-09-23T17:59:00.000Z', NOW)).toBe('1 minute ago');
    expect(formatRelativeTime('2026-09-23T17:43:00.000Z', NOW)).toBe('17 minutes ago');
    expect(formatRelativeTime('2026-09-23T17:00:00.000Z', NOW)).toBe('1 hour ago');
    expect(formatRelativeTime('2026-09-23T13:00:00.000Z', NOW)).toBe('5 hours ago');
    expect(formatRelativeTime('2026-09-22T18:00:00.000Z', NOW)).toBe('1 day ago');
    expect(formatRelativeTime('2026-09-18T18:00:00.000Z', NOW)).toBe('5 days ago');
  });

  test('past a week it gives up on relativity and names the date, because "37 days ago" is not a date anyone can use', () => {
    expect(formatRelativeTime('2026-08-01T18:00:00.000Z', NOW, 'UTC')).toBe('Aug 1, 2026');
  });

  test('a date beyond the relative window is the viewer\'s own day, not the server\'s — the same instant is two dates in two zones', () => {
    // 01:30 UTC on the 2nd is still the 1st in New York: a whole-day error,
    // which is what §4.11 asks a timezone test to be able to catch.
    const instant = '2026-08-02T01:30:00.000Z';
    expect(formatRelativeTime(instant, NOW, 'UTC')).toBe('Aug 2, 2026');
    expect(formatRelativeTime(instant, NOW, 'America/New_York')).toBe('Aug 1, 2026');
  });

  test('the absolute form beside it still names its zone, and still differs between two readers', () => {
    const instant = '2026-09-23T17:43:00.000Z';
    const utc = formatRevisionDate(instant, 'UTC');
    const tokyo = formatRevisionDate(instant, 'Asia/Tokyo');
    expect(utc).not.toBe(tokyo);
    expect(utc).toMatch(/UTC/);
    expect(tokyo).toMatch(/GMT\+9/);
  });
});
