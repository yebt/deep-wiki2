import { mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, test } from 'vitest';
import PresenceIndicator from './PresenceIndicator.vue';

describe('PresenceIndicator', () => {
  test('renders nothing when nobody is editing', async () => {
    const component = await mountSuspended(PresenceIndicator, { props: { editors: [] } });

    expect(component.find('[role="status"]').exists()).toBe(false);
  });

  // docs/UI-CHECKLIST.md §4.8 ("who and since when") and §4.11
  // (timestamps: viewer's own zone, the zone named in the string, the
  // exact instant preserved in `<time datetime>`).
  test('names the editor and states since when, with the zone named and the instant preserved', async () => {
    const component = await mountSuspended(PresenceIndicator, {
      props: { editors: [{ userId: 'u1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }] },
    });

    expect(component.text()).toMatch(/Ana is editing since/);
    const time = component.get('time');
    expect(time.attributes('datetime')).toBe('2026-01-01T00:00:00.000Z');
    // A bare local time is ambiguous the moment two readers are in
    // different places — the rendered string must name its zone.
    expect(time.text()).toMatch(/GMT|UTC|[A-Z]{2,5}$/);
  });

  // §4.8: "the presence row is not conveyed by color alone" — a second,
  // non-colour signal (the icon) must be present, not just a tinted chip.
  test('carries a non-colour signal alongside the tint', async () => {
    const component = await mountSuspended(PresenceIndicator, {
      props: { editors: [{ userId: 'u1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }] },
    });

    expect(component.findComponent({ name: 'UIcon' }).exists() || component.find('[class*="i-lucide-pencil"]').exists()).toBe(true);
  });

  test('renders one row per concurrent editor', async () => {
    const component = await mountSuspended(PresenceIndicator, {
      props: {
        editors: [
          { userId: 'u1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' },
          { userId: 'u2', userDisplayName: 'Beto', since: '2026-01-01T00:00:00.000Z' },
        ],
      },
    });

    expect(component.text()).toMatch(/Ana is editing/);
    expect(component.text()).toMatch(/Beto is editing/);
  });

  // §7.1/§7.3: only integer multiples of the 4px spacing grid in
  // project-authored markup — `gap-1.5`/`px-2.5`/`text-[10px]` were
  // off-grid arbitrary values flagged in review.
  test('uses only on-grid spacing utilities, never an arbitrary bracketed value', async () => {
    const component = await mountSuspended(PresenceIndicator, {
      props: { editors: [{ userId: 'u1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }] },
    });

    expect(component.html()).not.toMatch(/\[\d/); // no `text-[10px]`-shaped arbitrary value
    expect(component.html()).not.toMatch(/-1\.5\b|-2\.5\b/); // no half-step spacing in this file's own markup
  });
});
