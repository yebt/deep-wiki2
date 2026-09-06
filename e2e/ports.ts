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
 */
export const API_PORT = 4000;
export const WEB_PORT = 4173;

export const API_URL = `http://localhost:${API_PORT}`;
export const WEB_URL = `http://localhost:${WEB_PORT}`;
