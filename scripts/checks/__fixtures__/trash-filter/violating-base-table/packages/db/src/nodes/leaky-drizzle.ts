/** Violates rule 1: reads the base nodes table through the Drizzle builder twin. */
import { db, nodes } from '../db';

export function leakDrizzle() {
  return db.select().from(nodes);
}
