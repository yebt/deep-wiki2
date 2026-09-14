import { ilike } from 'drizzle-orm';
import { nodes } from '../schema';

// A minimal stand-in for Drizzle's database handle: only the builder entry
// points the check has to recognise, loosely typed so the fixture stays a
// faithful violation without pulling drizzle-orm's types into a fixture.
interface Db {
  select(): { from(table: unknown): { where(predicate: unknown): unknown } };
  insert(table: unknown): { values(row: unknown): unknown };
  update(table: unknown): { set(patch: unknown): { where(predicate: unknown): unknown } };
  delete(table: unknown): { where(predicate: unknown): unknown };
}

// A prefix predicate on the materialised path column, written with Drizzle's
// builder rather than as SQL text, and outside the one module allowed it.
export function leakyDescendants(db: Db, pattern: string) {
  return db.select().from(nodes).where(ilike(nodes.path, pattern));
}
