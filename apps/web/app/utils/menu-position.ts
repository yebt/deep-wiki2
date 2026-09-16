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

/**
 * The selection toolbar's box: five 32px controls at `p-1` with `gap-1`,
 * rounded up — like the menu estimates, wrong in the safe direction, so
 * a clamp fires a little early rather than a little late.
 */
export const TOOLBAR_WIDTH_ESTIMATE = 200;
export const TOOLBAR_HEIGHT_ESTIMATE = 40;
/** Between the toolbar's edge and the text it floats over. */
const TOOLBAR_GAP = 8;

export interface LineRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Both ends of the selection, as the selection plugin reports them (`coordsAtPos` of each). */
export interface RangeCoords {
  readonly from: LineRect;
  readonly to: LineRect;
}

export interface ToolbarPlacement {
  readonly top: number;
  readonly left: number;
  /** Above the range's first line, or — when the viewport's top edge is too close — below its last. */
  readonly placement: 'above' | 'below';
}

/**
 * Where the selection toolbar floats: above the first line of the range,
 * centred on the range when it is one line and on its start when it
 * spans several (the two ends then share no column to centre between);
 * below the last line when there is no room above; and never past a
 * viewport edge in either axis, so at 320px it stays whole
 * (docs/UI-CHECKLIST.md §4.6, §6).
 */
export function positionToolbar(
  coords: RangeCoords,
  viewport: Viewport = { width: window.innerWidth, height: window.innerHeight },
): ToolbarPlacement {
  const above = coords.from.top - TOOLBAR_GAP - TOOLBAR_HEIGHT_ESTIMATE;
  const fitsAbove = above >= VIEWPORT_MARGIN;
  const below = Math.min(coords.to.bottom + TOOLBAR_GAP, viewport.height - VIEWPORT_MARGIN - TOOLBAR_HEIGHT_ESTIMATE);
  const top = fitsAbove ? above : Math.max(VIEWPORT_MARGIN, below);

  const singleLine = coords.from.top === coords.to.top;
  const anchor = singleLine ? (coords.from.left + coords.to.right) / 2 : coords.from.left;
  const rightmost = viewport.width - VIEWPORT_MARGIN - TOOLBAR_WIDTH_ESTIMATE;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(anchor - TOOLBAR_WIDTH_ESTIMATE / 2, rightmost));

  return { top, left, placement: fitsAbove ? 'above' : 'below' };
}
