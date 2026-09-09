/**
 * Where a floating editor menu opens, given the caret's viewport-relative
 * rect (document-editor spec: "Menus Reposition To Stay In The Viewport";
 * docs/UI-CHECKLIST.md §4.6 "Menus reposition to stay in the viewport near
 * the bottom or right edge… never render clipped or off-screen").
 *
 * Lives here rather than inside EditorSurface.vue's `<script setup>` for one
 * reason: `<script setup>` bindings are not exported, so this geometry — the
 * one genuinely pure, edge-case-dense piece of that component — could not be
 * unit-tested at all from where it used to sit. Nothing else moved with it.
 */

/**
 * The menus' own `min-w-*` plus a handful of rows — real content can be
 * shorter, never taller by more than a row or two, so flipping a little
 * early is the safe direction to be wrong in.
 */
export const MENU_HEIGHT_ESTIMATE = 220;
export const MENU_WIDTH_ESTIMATE = 260;

/** Kept clear of the viewport edge so a flipped or clamped menu never sits flush against it. */
const VIEWPORT_MARGIN = 8;

export interface CaretCoords {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * `coordsAtPos()` returns viewport-relative coordinates, which is exactly
 * what a `position: fixed` element needs directly — no ancestor-offset math.
 * The viewport is a parameter (defaulting to the real window) purely so the
 * function stays pure and directly testable.
 */
export function positionMenu(
  coords: CaretCoords,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight },
): { top: number; left: number } {
  const spaceBelow = viewport.height - coords.bottom;
  const top = spaceBelow < MENU_HEIGHT_ESTIMATE ? Math.max(VIEWPORT_MARGIN, coords.top - MENU_HEIGHT_ESTIMATE) : coords.bottom + 4;
  const left = Math.min(coords.left, viewport.width - MENU_WIDTH_ESTIMATE - VIEWPORT_MARGIN);
  return { top, left: Math.max(VIEWPORT_MARGIN, left) };
}
