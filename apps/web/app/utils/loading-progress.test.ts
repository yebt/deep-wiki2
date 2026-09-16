// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest';
import { easedProgress, loadingProgress, prefersReducedMotion } from './loading-progress';

describe('easedProgress()', () => {
  test('is Nuxt’s own curve: 0 at the start, ~63% at the nominal duration, never 100', () => {
    expect(easedProgress(2000, 0)).toBe(0);
    expect(easedProgress(2000, 2000)).toBeCloseTo((2 / Math.PI) * 100 * Math.atan(2), 6);
    expect(easedProgress(2000, 2000)).toBeGreaterThan(60);
    expect(easedProgress(2000, 2000)).toBeLessThan(75);
    expect(easedProgress(2000, 60_000)).toBeLessThan(100);
  });

  test('is monotonic', () => {
    let previous = -1;
    for (let elapsed = 0; elapsed <= 10_000; elapsed += 250) {
      const value = easedProgress(2000, elapsed);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});

describe('loadingProgress()', () => {
  test('creeps along the curve when motion is welcome', () => {
    expect(loadingProgress(2000, 500, false)).toBe(easedProgress(2000, 500));
  });

  test('is full from the first frame under reduced motion: no growth to animate', () => {
    expect(loadingProgress(2000, 0, true)).toBe(100);
    expect(loadingProgress(2000, 1500, true)).toBe(100);
  });
});

describe('prefersReducedMotion()', () => {
  const globalWithWindow = globalThis as unknown as { window?: unknown };

  afterEach(() => {
    delete globalWithWindow.window;
  });

  test('is false where there is no window (SSR) and where matchMedia is missing', () => {
    expect(prefersReducedMotion()).toBe(false);
    globalWithWindow.window = {};
    expect(prefersReducedMotion()).toBe(false);
  });

  test('reads the media query when the browser exposes it', () => {
    const matchMedia = vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' }));
    globalWithWindow.window = { matchMedia };

    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(loadingProgress(2000, 0)).toBe(100);
  });
});
