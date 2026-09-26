import { viewerTimeZone } from '~/composables/useViewerTimeZone';

/**
 * "When", said the way a conversation says it — "17 minutes ago", "1 day
 * ago" — beside `formatRevisionDate`, which is how a *record* says it
 * ("Sep 23, 2026, 1:43 PM EDT").
 *
 * ## Why a second time helper, and how it stays inside §4.11
 *
 * docs/UI-CHECKLIST.md §4.11 binds every rendered time: the viewer's own
 * zone, the zone named in the string, the exact instant in `<time
 * datetime>`, never server-rendered, and a test in two zones. A relative
 * string cannot name a zone, and it does not need to: **it is the same
 * string for every reader in every zone**, which is the ambiguity §4.11
 * exists to remove, reached by removing the clock rather than by labelling
 * it. The rule's other halves still bind and still hold here — the exact
 * instant lives in `datetime`, the absolute zone-named form stands beside
 * it as the element's `title` (reachable on hover *and* focus), and the
 * two-zone test is made against that absolute form, the only half of the
 * pair that can differ between two readers. §4.11 is amended in place with
 * this clause; the reasoning is in the Review Log, 2026-09-23.
 *
 * ## Past a week, relativity stops being information
 *
 * "37 days ago" is a number a reader has to convert back into a date
 * before it means anything, so beyond seven days this renders the date
 * itself — in the **viewer's** zone, which is §4.11's first rule and the
 * reason `timeZone` is a parameter here exactly as it is in
 * `formatRevisionDate`: an instant near midnight UTC is two different days
 * for two readers, and a whole-day error is what a timezone test has to be
 * able to catch.
 *
 * ## Never server-rendered
 *
 * The value depends on `Date.now()`, so a server render would bake in the
 * server's clock and then change under hydration — §4.11's fourth rule,
 * and a Vue hydration mismatch besides. The one surface that calls this,
 * the comment thread panel, renders only from a client fetch
 * (`usePageComments.load()` runs in `onMounted`), so there is no server
 * pass to disagree with. Said here because it is an invariant the next
 * person breaks by moving a fetch.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Past this, a relative string is arithmetic rather than information. */
const RELATIVE_WINDOW = 7 * DAY;

const RELATIVE = new Intl.RelativeTimeFormat('en-US', { numeric: 'always' });

const DATE_PARTS: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };

/**
 * `iso` as a reader would say it, relative to `now` (the current instant
 * by default) — and as a plain date once it is more than a week old, in
 * `timeZone` or the viewer's own.
 *
 * Throws on an unparsable string, like `formatRevisionDate`: a comment
 * without a real `createdAt` is a data bug, not a display one.
 */
export function formatRelativeTime(iso: string, now: Date = new Date(), timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatRelativeTime: "${iso}" is not a valid ISO timestamp`);
  }

  const elapsed = now.getTime() - date.getTime();
  // A client clock a little behind the server's makes `elapsed` negative
  // for something that has just happened; "in 20 seconds" about a comment
  // the person watched themselves post is worse than no precision at all.
  if (elapsed < MINUTE) return 'just now';
  if (elapsed < HOUR) return RELATIVE.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return RELATIVE.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed < RELATIVE_WINDOW) return RELATIVE.format(-Math.floor(elapsed / DAY), 'day');

  const zone = timeZone ?? viewerTimeZone();
  return new Intl.DateTimeFormat('en-US', zone === undefined ? DATE_PARTS : { ...DATE_PARTS, timeZone: zone }).format(date);
}
