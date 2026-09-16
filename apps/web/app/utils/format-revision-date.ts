import { viewerTimeZone } from '~/composables/useViewerTimeZone';

/**
 * "When" a revision was saved, for the page-history screen
 * (docs/UI-CHECKLIST.md §3, "Success" wants a confirmation the user can
 * act on, not a bare timestamp; revision-history spec's `createdAt` is an
 * ISO string).
 *
 * **Rendered in the viewer's own timezone** (owner decision, 2026-09-08).
 * A wiki whose premise is a team sharing one source of truth is a wiki
 * whose readers are in different places: "Sep 8, 2026, 10:44 AM UTC" asks
 * every reader to do the arithmetic, and the reader most likely to get it
 * wrong is the one furthest from the server.
 *
 * Three properties this function is built to hold, each with a test:
 *
 * 1. **The zone is read at call time, never cached at module load.** An
 *    `Intl.DateTimeFormat` built once at import bakes in whichever zone
 *    was current then. That is wrong in a test that re-zones, and it is
 *    wrong in a long-lived tab whose machine crosses a DST boundary.
 * 2. **`timeZone` is an explicit parameter.** Its absence means "the
 *    runtime's zone", which is the screen's normal path; passing it is
 *    what lets a test assert one instant against two zones, which is the
 *    only assertion that can fail for the right reason.
 * 3. **The zone label is part of the string.** See the format note below.
 *
 * On SSR: the lists that carry these timestamps are server-rendered since
 * the read layer (`useApiRead`, 2026-09-16), and the server has no idea
 * of the viewer's zone. So an omitted `timeZone` means "the viewer's zone
 * *once the document is theirs*": `viewerTimeZone()` answers `UTC` on the
 * server and on the client while it hydrates the server's bytes — both
 * sides render the same, labelled, unambiguous string — and the runtime's
 * zone from the moment hydration resolves, which re-renders every
 * timestamp on screen (the value is reactive). The instant itself
 * survives in the `<time datetime>` attribute regardless.
 * `e2e/history.spec.ts` asserts both halves: that two viewers in two zones
 * see two different strings once hydrated, and that the browser logs no
 * hydration mismatch while getting there.
 *
 * The locale stays fixed to `en-US`: this project's artefact language is
 * English (CLAUDE.md), and the timezone is what the owner decision is
 * about. Localising the *language* as well is a separate, larger change
 * (it would move this string, the surrounding copy and the `lang`
 * attribute together).
 */

/**
 * Deliberately spelled out rather than `dateStyle: 'medium', timeStyle:
 * 'short'`, which is what this rendered before. ECMA-402 rejects
 * `dateStyle`/`timeStyle` combined with any individual component option,
 * `timeZoneName` included — `new Intl.DateTimeFormat('en-US', {
 * dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' })`
 * throws `TypeError: Invalid option`. The fields below reproduce the
 * medium/short rendering exactly ("Sep 8, 2026, 3:45 PM") and add the
 * zone; `timeStyle: 'long'`, the other way to reach a zone label, would
 * have dragged seconds in with it.
 */
const PARTS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

/**
 * Renders an ISO timestamp in `timeZone`, or in the viewer's own timezone
 * when it is omitted — e.g. "Sep 8, 2026, 11:45 AM EDT", "Sep 9, 2026,
 * 12:45 AM GMT+9" — UTC until a server-rendered document has hydrated
 * (see the note above). Throws on an unparsable string: a revision
 * without a real `createdAt` is a data bug, not a display one.
 */
export function formatRevisionDate(iso: string, timeZone?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatRevisionDate: "${iso}" is not a valid ISO timestamp`);
  }
  const zone = timeZone ?? viewerTimeZone();
  // Constructed per call, not hoisted to a module constant — see property
  // 1 above. A revision list is tens of rows; this is not a hot path.
  return new Intl.DateTimeFormat('en-US', zone === undefined ? PARTS : { ...PARTS, timeZone: zone }).format(date);
}
