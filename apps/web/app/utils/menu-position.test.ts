import { describe, expect, test } from 'vitest';
import { MENU_HEIGHT_ESTIMATE, MENU_WIDTH_ESTIMATE, positionMenu, positionToolbar, TOOLBAR_HEIGHT_ESTIMATE, TOOLBAR_WIDTH_ESTIMATE } from './menu-position';

/**
 * document-editor spec: "Menus Reposition To Stay In The Viewport" —
 * "Mention and slash command menus MUST reposition when near the bottom or
 * right edge of the viewport and MUST NOT render clipped or off-screen."
 *
 * These assert the geometric promise, not the arithmetic: a menu that fits
 * below the caret is left alone; one that does not is placed so its whole
 * estimated box stays inside the viewport. Nothing here reads
 * `coords.bottom + 4` back out of the implementation.
 */
const VIEWPORT = { width: 1280, height: 800 };

/** The box the returned origin implies, given the estimates the menus are sized against. */
function boxAt(origin: { top: number; left: number }) {
  return {
    top: origin.top,
    bottom: origin.top + MENU_HEIGHT_ESTIMATE,
    left: origin.left,
    right: origin.left + MENU_WIDTH_ESTIMATE,
  };
}

describe('positionMenu', () => {
  test('a menu with room below the caret opens below it, unmoved horizontally', () => {
    const caret = { top: 100, bottom: 120, left: 300 };

    const origin = positionMenu(caret, VIEWPORT);

    expect(origin.top).toBeGreaterThanOrEqual(caret.bottom);
    expect(origin.left).toBe(caret.left);
    expect(boxAt(origin).bottom).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test('a menu with no room below the caret flips above it instead of being clipped', () => {
    // 60px of viewport left under the caret — far less than a menu needs.
    const caret = { top: 720, bottom: 740, left: 300 };

    const origin = positionMenu(caret, VIEWPORT);
    const box = boxAt(origin);

    expect(box.bottom).toBeLessThanOrEqual(caret.top);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(VIEWPORT.height);
  });

  test('the flip happens before the menu would be clipped, not after', () => {
    // Exactly one pixel less room below the caret than the menu occupies.
    const caret = { top: 560, bottom: VIEWPORT.height - MENU_HEIGHT_ESTIMATE + 1, left: 300 };

    const origin = positionMenu(caret, VIEWPORT);

    expect(origin.top).toBeLessThan(caret.top);
  });

  test('a caret against the right edge pulls the menu back inside the viewport', () => {
    const caret = { top: 100, bottom: 120, left: VIEWPORT.width - 20 };

    const origin = positionMenu(caret, VIEWPORT);

    expect(boxAt(origin).right).toBeLessThanOrEqual(VIEWPORT.width);
    expect(origin.left).toBeGreaterThanOrEqual(0);
  });

  test('a caret against the left edge never pushes the menu off-screen to the left', () => {
    const caret = { top: 100, bottom: 120, left: 0 };

    const origin = positionMenu(caret, VIEWPORT);

    expect(origin.left).toBeGreaterThanOrEqual(0);
  });

  test('a viewport too short for the menu in either direction still keeps its top edge on-screen', () => {
    const short = { width: 1280, height: 240 };
    const caret = { top: 180, bottom: 200, left: 300 };

    const origin = positionMenu(caret, short);

    expect(origin.top).toBeGreaterThanOrEqual(0);
    expect(origin.left).toBeGreaterThanOrEqual(0);
  });

  test('defaults to the real window when no viewport is supplied', () => {
    const caret = { top: 10, bottom: 30, left: 40 };

    expect(positionMenu(caret)).toEqual(positionMenu(caret, { width: window.innerWidth, height: window.innerHeight }));
  });
});

/**
 * The selection toolbar floats over the range it formats — above the
 * first line where there is room, below the last line where there is
 * not (docs/UI-CHECKLIST.md §4.6: menus reposition to stay in the
 * viewport, never clipped), and always inside a 320px viewport (§6).
 * Same viewport-relative coordinates as the menus: the selection
 * plugin reports `coordsAtPos` of both ends.
 */
describe('positionToolbar', () => {
  const VIEWPORT = { width: 1280, height: 900 };
  const line = (top: number, left: number, right: number) => ({ top, bottom: top + 26, left, right });
  const size = { width: TOOLBAR_WIDTH_ESTIMATE, height: TOOLBAR_HEIGHT_ESTIMATE };

  test('with room above the first line, it stands above it, its bottom edge a gap short of the text', () => {
    const coords = { from: line(300, 400, 400), to: line(300, 600, 600) };

    const origin = positionToolbar(coords, VIEWPORT);

    expect(origin.placement).toBe('above');
    expect(origin.top + size.height).toBeLessThan(coords.from.top);
    expect(origin.top + size.height).toBeGreaterThan(coords.from.top - 16);
  });

  test('centres on a single-line range', () => {
    const coords = { from: line(300, 400, 400), to: line(300, 600, 600) };

    const origin = positionToolbar(coords, VIEWPORT);

    expect(origin.left + size.width / 2).toBe(500);
  });

  test('centres on the start of a range that spans lines, since its two ends share no column', () => {
    const coords = { from: line(300, 500, 500), to: line(352, 120, 120) };

    const origin = positionToolbar(coords, VIEWPORT);

    expect(origin.left + size.width / 2).toBe(500);
  });

  test('with no room above, it flips below the last line', () => {
    const coords = { from: line(10, 400, 400), to: line(36, 200, 200) };

    const origin = positionToolbar(coords, VIEWPORT);

    expect(origin.placement).toBe('below');
    expect(origin.top).toBeGreaterThan(coords.to.bottom);
    expect(origin.top).toBeLessThan(coords.to.bottom + 16);
  });

  test('flipped below at the bottom edge, it is still kept on screen', () => {
    const short = { width: 1280, height: 60 };
    const coords = { from: line(10, 400, 400), to: line(36, 200, 200) };

    const origin = positionToolbar(coords, short);

    expect(origin.top).toBeGreaterThanOrEqual(0);
    expect(origin.top + size.height).toBeLessThanOrEqual(short.height);
  });

  test('a range against the right edge pulls the toolbar back inside the viewport', () => {
    const coords = { from: line(300, 1250, 1250), to: line(300, 1270, 1270) };

    const origin = positionToolbar(coords, VIEWPORT);

    expect(origin.left + size.width).toBeLessThanOrEqual(VIEWPORT.width);
  });

  test('a range against the left edge never pushes the toolbar off-screen to the left', () => {
    const coords = { from: line(300, 0, 0), to: line(300, 10, 10) };

    const origin = positionToolbar(coords, VIEWPORT);

    expect(origin.left).toBeGreaterThanOrEqual(0);
  });

  test('never overflows a 320px viewport, wherever the range is', () => {
    const narrow = { width: 320, height: 900 };
    for (const [left, right] of [
      [16, 40],
      [150, 170],
      [290, 304],
    ] as const) {
      const origin = positionToolbar({ from: line(300, left, left), to: line(300, right, right) }, narrow);
      expect(origin.left).toBeGreaterThanOrEqual(0);
      expect(origin.left + size.width).toBeLessThanOrEqual(narrow.width);
    }
  });

  test('defaults to the real window when no viewport is supplied', () => {
    const coords = { from: line(300, 400, 400), to: line(300, 600, 600) };

    expect(positionToolbar(coords)).toEqual(positionToolbar(coords, { width: window.innerWidth, height: window.innerHeight }));
  });
});
