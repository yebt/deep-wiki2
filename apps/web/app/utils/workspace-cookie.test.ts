import { describe, expect, test } from 'vitest';
import { LAST_WORKSPACE_COOKIE, parseWorkspaceCookieValue, rememberWorkspaceCookieValue } from './workspace-cookie';

/**
 * The cookie `/` reopens on carries both names of a workspace — the id
 * the API is keyed by and the slug every address carries — and nothing
 * that is not exactly that pair is ever routed to.
 */
describe('workspace cookie', () => {
  test('spells a workspace as `<id>:<slug>` and reads it back', () => {
    const value = rememberWorkspaceCookieValue({ id: 'ws-1', slug: 'acme' });
    expect(value).toBe('ws-1:acme');
    expect(parseWorkspaceCookieValue(value)).toEqual({ id: 'ws-1', slug: 'acme' });
    expect(LAST_WORKSPACE_COOKIE).toBe('dw-workspace');
  });

  test('anything that is not a well-formed pair remembers nothing — including the id-only shape from before 2026-09-17', () => {
    for (const value of ['ws-only', '../admin:slug', 'ws-1:Not A Slug', 'ws-1:', ':slug', '', null, undefined]) {
      expect(parseWorkspaceCookieValue(value)).toBeNull();
    }
  });
});
