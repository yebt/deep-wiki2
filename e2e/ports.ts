/**
 * The ports the e2e harness runs on, in one place.
 *
 * `global-setup.ts` starts `apps/api` on `API_PORT` while `playwright.config.ts`
 * starts `apps/web` on `WEB_PORT`. The browser then has to be told where the
 * API is — and until this module existed, it was not: the web server fell back
 * to its own compiled default, which had been changed to a different port, and
 * seven auth tests failed with "Could not reach the server" while nothing about
 * the application was broken.
 *
 * The same fact must not be written twice. See docs/TODO.md, which records
 * three earlier instances of this exact shape.
 *
 * The values themselves are per-worktree, from the same derivation the
 * container stacks use (packages/db/testing/worktree.ts): the main
 * checkout keeps 4000 and 4173, every linked worktree gets its own pair,
 * so two worktrees can run `bun run e2e` at the same time. That module is
 * deliberately free of Bun-only APIs — this file is loaded by Playwright's
 * Node process — and is imported by relative path for the same reason.
 */
import { harnessIdentity } from '../packages/db/testing/worktree';

const harness = harnessIdentity();

export const API_PORT = harness.ports.api;
export const WEB_PORT = harness.ports.web;

/**
 * The API under test sends mail through the test Mailpit that
 * `apps/api/testing/compose.yaml` publishes — same worktree, same port.
 */
export const MAILPIT_SMTP_PORT = harness.ports.mailpitSmtp;
/** Where a test reads that mail back (Mailpit's REST API), same worktree. */
export const MAILPIT_HTTP_URL = `http://localhost:${harness.ports.mailpitHttp}`;

export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
