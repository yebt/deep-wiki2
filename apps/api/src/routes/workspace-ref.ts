/**
 * A workspace named the way a URL names it.
 *
 * The web app's addresses carry the workspace's **slug** (`/w/<slug>`,
 * `/w/<slug>/p/<id>`), because a slug is the name a team recognises and
 * chose; the API and the database are keyed by the workspace's **id**,
 * because an id never changes and is what every grant, node and revision
 * points at. A screen that stands at `/w/<slug>` therefore asks the API
 * by slug — and rather than a resolver round trip in front of every such
 * request, the workspace-scoped routes a screen calls directly
 * (`/workspaces/:ref/activity`, `/workspaces/:ref/members`) accept either
 * key and resolve it here, once, into the id the rest of the handler is
 * written against.
 *
 * The slug is tried first. A slug is lowercase letters, digits and single
 * hyphens (`WorkspaceSlugSchema`), which a UUID also satisfies, so a team
 * that chose a UUID-shaped slug — legal, if strange — is still found by
 * it; only when no workspace carries `ref` as its slug is a UUID-shaped
 * `ref` read as an id. Anything that is neither shape names nothing and
 * resolves to `null`, which every caller answers with the same 404 an
 * unknown id gets: this function decides identity, never access.
 */
import type postgres from 'postgres';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `WorkspaceSlugSchema`'s alphabet, as a shape check before the query — anything else cannot be a slug and is not looked up. */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function resolveWorkspaceId(sql: postgres.Sql | postgres.TransactionSql, ref: string): Promise<string | null> {
  if (SLUG_SHAPE.test(ref)) {
    const [bySlug] = await sql<{ id: string }[]>`SELECT id FROM workspaces WHERE slug = ${ref}`;
    if (bySlug) return bySlug.id;
  }
  return UUID_SHAPE.test(ref) ? ref : null;
}
