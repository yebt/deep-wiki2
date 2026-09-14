import { eq } from 'drizzle-orm';
import { permissions } from '../schema';

// A minimal stand-in for Drizzle's database handle: only the builder entry
// points the check has to recognise, loosely typed so the fixture stays a
// faithful violation without pulling drizzle-orm's types into a fixture.
interface Db {
  select(): { from(table: unknown): { where(predicate: unknown): unknown } };
  insert(table: unknown): { values(row: unknown): unknown };
  update(table: unknown): { set(patch: unknown): { where(predicate: unknown): unknown } };
  delete(table: unknown): { where(predicate: unknown): unknown };
}

// A second decision path, expressed through Drizzle's query builder instead
// of raw SQL text. Same read, same failure.
export function leakyQuery(db: Db, resourceId: string) {
  return db.select().from(permissions).where(eq(permissions.resourceId, resourceId));
}

export function leakyGrant(db: Db, row: unknown) {
  return db.insert(permissions).values(row);
}
