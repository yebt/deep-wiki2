import { describe, expect, test } from 'vitest';
import { MENU_HEIGHT_ESTIMATE, MENU_WIDTH_ESTIMATE, positionMenu } from './menu-position';

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
