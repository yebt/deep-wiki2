/**
 * "When" a revision was saved, for the page-history screen
 * (docs/UI-CHECKLIST.md §3, "Success" wants a confirmation the user can
 * act on, not a bare timestamp; revision-history spec's `createdAt` is an
 * ISO string).
 *
 * Fixed to `en-US` and UTC rather than the runtime's locale/timezone: this
 * project's artefact language default is English (CLAUDE.md), and a
 * server-rendered timestamp formatted against the *server's* locale/zone
 * would mismatch a client hydrating in a different one, which is exactly
 * the class of defect a relative ("2 minutes ago") format would make
 * worse — its value keeps changing after the first paint. An absolute,
 * deterministic string is both SSR-safe and the same string an e2e test
 * can assert on.
 */
const FORMATTER = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Renders an ISO timestamp as e.g. "Sep 8, 2026, 3:45 PM UTC". Throws on an unparsable string — a revision without a real `createdAt` is a data bug, not a display one. */
export function formatRevisionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`formatRevisionDate: "${iso}" is not a valid ISO timestamp`);
  }
  return `${FORMATTER.format(date)} UTC`;
}
