import { describe, expect, test } from 'bun:test';
import { MAX_SLUG_LENGTH, slugifyTitle } from './slug';

/**
 * A node's slug is derived from its title and is the second half of
 * `nodes_parent_slug_unique (parent_id, slug)` — the constraint
 * `packages/db/seed.ts` looks a node up by. Everything here is about what
 * a user can type into a name field and what the database will accept
 * back: `'` and `/` are ordinary in a page title and impossible in a
 * slug, and the column carries no shape CHECK, so this function is the
 * only thing standing between a title and a row.
 */
describe('slugifyTitle', () => {
  test('lowercases and joins words with a single hyphen', () => {
    expect(slugifyTitle('Local Development Setup')).toBe('local-development-setup');
  });

  test('strips punctuation rather than encoding it', () => {
    expect(slugifyTitle("Eduardo's Notes — v2 (draft)")).toBe('eduardo-s-notes-v2-draft');
    expect(slugifyTitle('auth/oauth2')).toBe('auth-oauth2');
  });

  test('folds diacritics instead of dropping the letters they sit on', () => {
    expect(slugifyTitle('Sesión de diseño')).toBe('sesion-de-diseno');
  });

  test('collapses runs and trims the edges, so no slug starts or ends with a hyphen', () => {
    expect(slugifyTitle('  ---  Hello   ---  World ---  ')).toBe('hello-world');
  });

  test('truncates to the maximum length without leaving a trailing hyphen', () => {
    const slug = slugifyTitle(`${'a'.repeat(MAX_SLUG_LENGTH - 1)} bbbbb`);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug).toBe('a'.repeat(MAX_SLUG_LENGTH - 1));
  });

  /**
   * A title of pure punctuation has no slug. Returning an empty string
   * rather than inventing one ("untitled", a random suffix) is what lets
   * the caller refuse with a reason the user can act on, instead of
   * silently creating a node under a name they did not choose.
   */
  test('a title with nothing sluggable in it yields the empty string', () => {
    expect(slugifyTitle('###')).toBe('');
    expect(slugifyTitle('   ')).toBe('');
    expect(slugifyTitle('…')).toBe('');
  });
});
