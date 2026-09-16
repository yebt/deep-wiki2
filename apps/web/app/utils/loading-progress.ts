/**
 * The progress curve for `<NuxtLoadingIndicator>` (`app.vue`), and the
 * one place the app decides what that indicator does under
 * `prefers-reduced-motion`.
 *
 * Nuxt's own curve (`nuxt/dist/app/composables/loading-indicator.js`,
 * `defaultEstimatedProgress`) is not exported, so it is restated here
 * for the motion case: an arctangent that reaches ~63% at `duration`
 * and creeps towards 100% without arriving, which is what a bar that
 * cannot know how long the hop will take should do.
 *
 * Under reduced motion the bar does not creep at all: it is drawn full
 * from the first frame and simply disappears when the screen lands.
 * docs/UI-CHECKLIST.md §5 makes reduced motion pass/fail and
 * docs/DESIGN-SYSTEM.md §6.6 keeps the meaning — "a hop is in flight" —
 * while dropping the motion; `main.css`'s global override already
 * shortens the bar's CSS transitions, but the growth is driven by
 * JavaScript per animation frame and only this function can stop it.
 */
export type ProgressEstimate = (duration: number, elapsed: number) => number;

/** Nuxt's default estimate, verbatim: `2/π · 100 · atan((elapsed/duration · 100) / 50)`. */
export function easedProgress(duration: number, elapsed: number): number {
  const completionPercentage = (elapsed / duration) * 100;
  return (2 / Math.PI) * 100 * Math.atan(completionPercentage / 50);
}

/** True when the viewer has asked their OS for less motion. Server-side, and without `matchMedia`, false. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The indicator's estimate: full at once under reduced motion, Nuxt's curve otherwise. */
export function loadingProgress(duration: number, elapsed: number, reduced: boolean = prefersReducedMotion()): number {
  return reduced ? 100 : easedProgress(duration, elapsed);
}
