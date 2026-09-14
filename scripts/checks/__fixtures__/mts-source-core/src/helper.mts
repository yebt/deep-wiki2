// `.mts` is a first-class TypeScript source extension that Bun, tsc and Node
// all execute. SOURCE_FILE_PATTERN read only `.ts`/`.tsx`, so this file was
// never opened.
import { Hono } from 'hono';

export const app = new Hono();
