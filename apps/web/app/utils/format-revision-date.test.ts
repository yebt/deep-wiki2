import { afterEach, describe, expect, test } from 'vitest';
import { markHydrated, markHydrating } from '~/composables/useViewerTimeZone';
import { formatRevisionDate } from './format-revision-date';

/**
 * "When" a revision was saved (docs/UI-CHECKLIST.md §3, "Success" wants a
 * confirmation the user can act on, not a bare timestamp).
 *
 * Every case below is the SAME instant — 2026-09-08T15:45:00Z — read from
 * a different place on earth. Asserting one instant against several zones
 * is the only way this file can fail for the right reason: a test that
 * renders a timestamp in whatever zone the machine running it happens to
 * be in proves nothing at all, and would stay green against a formatter
 * hardcoded to that machine's zone.
 */
const INSTANT = '2026-09-08T15:45:00.000Z';

const originalTz = process.env.TZ;

afterEach(() => {
  // Node re-reads process.env.TZ on assignment, so a leaked value would
  // silently re-zone every later test in this worker.
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe('formatRevisionDate', () => {
  test('renders one instant differently in two different timezones, including across the date line', () => {
    // 15:45 UTC is the morning of the 8th in New York and after midnight
    // on the 9th in Tokyo. The *day* differs, not only the clock time —
    // which is exactly the information a UTC-only rendering destroys.
    expect(formatRevisionDate(INSTANT, 'America/New_York')).toBe('Sep 8, 2026, 11:45 AM EDT');
    expect(formatRevisionDate(INSTANT, 'Asia/Tokyo')).toBe('Sep 9, 2026, 12:45 AM GMT+9');
  });

  test("defaults to the viewer's own timezone rather than UTC", () => {
    // The assertion that kills a hardcoded `timeZone: 'UTC'`: neither of
    // these zones is UTC, and the two outputs must not match each other.
    process.env.TZ = 'America/New_York';
    const inNewYork = formatRevisionDate(INSTANT);

    process.env.TZ = 'Asia/Tokyo';
    const inTokyo = formatRevisionDate(INSTANT);

    expect(inNewYork).toBe('Sep 8, 2026, 11:45 AM EDT');
    expect(inTokyo).toBe('Sep 9, 2026, 12:45 AM GMT+9');
    expect(inNewYork).not.toBe(inTokyo);
  });

  test('reads the viewer timezone at render time, not once at module load', () => {
    // A module-level `Intl.DateTimeFormat` would bake in whichever zone
    // was current when this file was first imported, so the second call
    // below would echo the first.
    process.env.TZ = 'UTC';
    const first = formatRevisionDate(INSTANT);

    process.env.TZ = 'Europe/Madrid';
    const second = formatRevisionDate(INSTANT);

    expect(first).toBe('Sep 8, 2026, 3:45 PM UTC');
    expect(second).toBe('Sep 8, 2026, 5:45 PM GMT+2');
  });

  test('always carries a zone label, so a bare local time is never ambiguous', () => {
    // This product is for teams that span timezones; "10:44 AM" alone
    // does not say whose morning it was.
    expect(formatRevisionDate(INSTANT, 'UTC')).toMatch(/ UTC$/);
    expect(formatRevisionDate(INSTANT, 'Asia/Kolkata')).toMatch(/ GMT\+5:30$/);
  });

  test('formats a different instant to a different string — not a hardcoded return', () => {
    expect(formatRevisionDate('2026-01-01T00:00:00.000Z', 'UTC')).toBe('Jan 1, 2026, 12:00 AM UTC');
  });

  test('throws on an unparsable timestamp rather than rendering "Invalid Date"', () => {
    expect(() => formatRevisionDate('not-a-date')).toThrow();
  });
});

describe('formatRevisionDate while a server-rendered document is hydrating', () => {
  afterEach(() => markHydrated());

  test('renders UTC, labelled, so the client hydrates exactly what the server sent, then the viewer zone', () => {
    markHydrating();
    expect(formatRevisionDate('2026-09-08T15:45:00.000Z')).toBe('Sep 8, 2026, 3:45 PM UTC');

    markHydrated();
    expect(formatRevisionDate('2026-09-08T15:45:00.000Z')).not.toMatch(/UTC$/);
  });

  test('an explicit timeZone wins over the hydration window', () => {
    markHydrating();
    expect(formatRevisionDate('2026-09-08T15:45:00.000Z', 'Asia/Tokyo')).toBe('Sep 9, 2026, 12:45 AM GMT+9');
  });
});
