import { describe, expect, test } from 'vitest';
import { STATUS_TOAST_MS, STATUS_TOAST_WITH_ACTION_MS, useStatusToast } from './useStatusToast';

/**
 * The toast tier, stated once (owner decision, 2026-09-23: "estas cosas
 * pueden manejarse como toasts"). What is asserted here is the *contract* —
 * the role, the announcement's politeness, the dismissal, the icon and how
 * long it stays — because those are what make a toast the same object on
 * every screen rather than a fourth notice shape per call site, which is
 * the defect the three `InlineNotice` tiers already exist to prevent
 * (docs/UI-CHECKLIST.md §4.1, §4.12).
 */
/**
 * `role` and `type` are not `UToast` props — they fall through to Reka's
 * toast root and to its announcement — so the toast records carry them as
 * extra keys the library's own type does not name.
 */
function shown(): (Record<string, unknown> & { actions?: { label: string; to?: string }[] })[] {
  return useToast().toasts.value as unknown as (Record<string, unknown> & { actions?: { label: string; to?: string }[] })[];
}

describe('useStatusToast', () => {
  test('a confirmation is a status, politely announced, dismissible, and named in one sentence', async () => {
    const before = shown().length;
    useStatusToast().confirmed({ message: 'Saved “Handbook”.' });
    await nextTick();

    const toast = shown()[before]!;
    expect(toast.title).toBe('Saved “Handbook”.');
    // A toast is a status wherever it is read from, and its announcement
    // is polite: a confirmation is not an interruption (§5).
    expect(toast.role).toBe('status');
    expect(toast.type).toBe('background');
    expect(toast.close).toBe(true);
    // Colour is never the only signal (§5), and the icon stands beside the
    // words rather than instead of them (§4.3).
    expect(toast.color).toBe('success');
    expect(toast.icon).toBeTruthy();
    expect(toast.duration).toBe(STATUS_TOAST_MS);
    expect(toast.actions).toBeUndefined();
  });

  test('one carrying a way back keeps that one action, and stays long enough to reach it', async () => {
    const before = shown().length;
    useStatusToast().confirmed({
      message: 'Moved “Day one” to the trash.',
      icon: 'i-lucide-trash-2',
      action: { label: 'Restore from Trash', to: '/w/acme/trash' },
    });
    await nextTick();

    const toast = shown()[before]!;
    expect(toast.icon).toBe('i-lucide-trash-2');
    expect(toast.duration).toBe(STATUS_TOAST_WITH_ACTION_MS);
    expect(toast.actions).toHaveLength(1);
    expect(toast.actions![0]!.label).toBe('Restore from Trash');
    expect(toast.actions![0]!.to).toBe('/w/acme/trash');
  });
});
