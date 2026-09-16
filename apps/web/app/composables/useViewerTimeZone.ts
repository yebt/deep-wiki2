/**
 * Which timezone a timestamp renders in *right now*: the viewer's own once
 * the client has hydrated the document, and UTC before that — on the
 * server, and on the client while it hydrates what the server sent.
 *
 * Timestamps read in the viewer's own zone (owner decision, 2026-09-08;
 * `formatRevisionDate`). Until the read layer (`useApiRead`), the lists
 * that carry them were fetched in `onMounted` and never server-rendered,
 * so "the runtime's zone" was always the browser's. Server-rendered, the
 * same call would format in the *server's* zone, and a viewer in another
 * zone would hydrate every timestamp into a text mismatch — Vue corrects
 * the text, but only after reporting the document broken.
 *
 * So both sides agree on UTC, labelled as such, for exactly the window in
 * which they must render the same bytes, and the viewer's zone takes over
 * the moment the app is theirs. `hydrated` is a module-level ref: on the
 * server it is never read as anything but "not hydrated" (`import.meta
 * .server` wins), so no request can see another's state; on the client
 * there is one document, and `plugins/viewer-time-zone.ts` flips it once
 * hydration resolves. Outside a server render it starts `true`, so a
 * client-only render — a client-side navigation, a unit test — formats
 * in the runtime's zone as before.
 */
const hydrated = shallowRef(true);

/** The client is hydrating a server-rendered document: render as the server did. */
export function markHydrating(): void {
  hydrated.value = false;
}

/** Hydration resolved: the document is the viewer's. */
export function markHydrated(): void {
  hydrated.value = true;
}

/** `'UTC'` while both sides must agree, `undefined` (the runtime's zone) once they need not. Reactive: a template that reads it re-renders when hydration resolves. */
export function viewerTimeZone(): string | undefined {
  if (import.meta.server) return 'UTC';
  return hydrated.value ? undefined : 'UTC';
}
