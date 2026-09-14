import { eq } from 'drizzle-orm';
import { links, pageTags } from '../schema';

// A minimal stand-in for Drizzle's database handle: only the builder entry
// points the check has to recognise, loosely typed so the fixture stays a
// faithful violation without pulling drizzle-orm's types into a fixture.
interface Db {
  select(): { from(table: unknown): { where(predicate: unknown): unknown } };
  insert(table: unknown): { values(row: unknown): unknown };
  update(table: unknown): { set(patch: unknown): { where(predicate: unknown): unknown } };
  delete(table: unknown): { where(predicate: unknown): unknown };
}

// The Drizzle spelling of INSERT/UPDATE/DELETE against the derived tables.
export function leakyInsert(db: Db, row: unknown) {
  return db.insert(links).values(row);
}

export function leakyPatch(db: Db, id: string) {
  return db.update(pageTags).set({ tag: 'patched' }).where(eq(pageTags.id, id));
}

export function leakyPrune(db: Db, id: string) {
  return db.delete(links).where(eq(links.id, id));
}
