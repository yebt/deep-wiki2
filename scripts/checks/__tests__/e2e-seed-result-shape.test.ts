import { describe, expect, test } from 'bun:test';
import type { SeedResult } from '../../../e2e/global-setup';

/**
 * e2e/seed.bun.ts's `main()` prints `{ url, dbName, ...seedFixtures()'s
 * return }` and e2e/global-setup.ts parses that line straight into a
 * `SeedResult`. The interface had fallen behind the seed's real output —
 * missing `keyboardEmail`/`keyboardInvitationToken` and every onboarding
 * field (`founderEmail`, `colleagueEmail`, `superRootEmail`,
 * `onboardingPassword`, `workspaceId`, and the `bookHistory*`/
 * `bookDiffSinceIso` fields) — and it only worked because `main()` spreads
 * `fixtures` straight into `writeFile(FIXTURES_PATH, JSON.stringify(...))`
 * untyped, so nothing ever forced the two to agree.
 *
 * This is a type-level assertion: the object literal below is exactly
 * seed.bun.ts's real output shape. Assigning an object literal to an
 * interface type triggers TypeScript's excess-property checking, so any
 * field this literal carries that `SeedResult` does not declare fails to
 * compile — `bun test` cannot see that (Bun strips types without checking
 * them), so `bun run typecheck` is the gate that turns a stale field back
 * into a compile error instead of a runtime `undefined` deep in a spec.
 */
describe('SeedResult matches e2e/seed.bun.ts’s real output', () => {
  test('every field seed.bun.ts prints is a real field on SeedResult', () => {
    const seed: SeedResult = {
      url: 'postgres://dw_test:dw_test@localhost:55432/dw_test_example',
      dbName: 'dw_test_example',
      founderEmail: 'e2e-founder@example.com',
      colleagueEmail: 'e2e-colleague@example.com',
      superRootEmail: 'e2e-super-root@example.com',
      onboardingPassword: 'correct-horse-battery-staple',
      signinEmail: 'e2e-signin@example.com',
      signinInvitationToken: 'signin-token',
      keyboardEmail: 'e2e-keyboard@example.com',
      keyboardInvitationToken: 'keyboard-token',
      expiredInvitationToken: 'expired-token',
      resetEmail: 'e2e-reset@example.com',
      resetToken: 'reset-token',
      readPageId: 'read-page-1',
      historyPageId: 'history-page-1',
      historyFirstRevisionId: 'history-rev-1',
      historySecondRevisionId: 'history-rev-2',
      emptyHistoryPageId: 'empty-history-page-1',
      workspaceId: 'workspace-1',
      bookHistoryShelfTitle: 'E2E Book Shelf',
      bookHistoryBookId: 'book-1',
      bookHistoryBookTitle: 'E2E Book History Handbook',
      bookHistoryPageAId: 'book-page-a',
      bookHistoryPageBId: 'book-page-b',
      bookDiffSinceIso: '2026-01-01T00:00:00.000Z',
      readerSessionToken: 'reader-token',
      outsiderSessionToken: 'outsider-token',
    };

    // The fields that were missing before this fix — named individually so
    // a regression naming one of them wrong fails here at runtime too, not
    // only at typecheck time.
    expect(seed.keyboardEmail).toBe('e2e-keyboard@example.com');
    expect(seed.keyboardInvitationToken).toBe('keyboard-token');
    expect(seed.founderEmail).toBe('e2e-founder@example.com');
    expect(seed.colleagueEmail).toBe('e2e-colleague@example.com');
    expect(seed.superRootEmail).toBe('e2e-super-root@example.com');
    expect(seed.onboardingPassword).toBe('correct-horse-battery-staple');
    expect(seed.workspaceId).toBe('workspace-1');
    expect(seed.bookHistoryShelfTitle).toBe('E2E Book Shelf');
    expect(seed.bookHistoryBookId).toBe('book-1');
    expect(seed.bookHistoryBookTitle).toBe('E2E Book History Handbook');
    expect(seed.bookHistoryPageAId).toBe('book-page-a');
    expect(seed.bookHistoryPageBId).toBe('book-page-b');
    expect(seed.bookDiffSinceIso).toBe('2026-01-01T00:00:00.000Z');
  });
});
