import { expect, type Page } from '@playwright/test';

/**
 * Measures horizontal overflow where it can actually be seen inside the
 * workspace frame. `document.documentElement.scrollWidth` never grows
 * there: `UDashboardPanel`'s generated body carries `overflow-y-auto`
 * (`apps/web/.nuxt/ui/dashboard-panel.ts`), and per the CSS spec a
 * non-`visible` `overflow-y` on an element whose `overflow-x` is
 * `visible` computes that axis to `auto` too — so *that* div, the
 * `[data-slot="body"]` ancestor of `#content-main` (AppShell's own
 * `<main>`), is the real horizontal scroll container an overflowing pane
 * clips into, invisibly to `document.documentElement.scrollWidth`. A
 * screen inside the frame can overflow the pane by hundreds of pixels
 * while the document-level number reads exactly equal to the viewport —
 * see docs/TODO.md, 2026-09-15.
 *
 * `expectNoHorizontalOverflow` asserts both: the document (still worth
 * checking — a screen outside the frame, like AuthShell in
 * e2e/auth-layout.spec.ts, has no pane to fall back on) and, when a
 * `[data-slot="body"]` pane exists, the pane itself. A fix that only
 * satisfies the document-level check is still caught.
 */

export interface OverflowMeasurement {
  readonly documentScrollWidth: number;
  readonly innerWidth: number;
  readonly paneScrollWidth: number | null;
  readonly paneClientWidth: number | null;
}

export async function measureOverflow(page: Page): Promise<OverflowMeasurement> {
  return page.evaluate(() => {
    const main = document.getElementById('content-main');
    const pane = main ? main.closest('[data-slot="body"]') : null;
    return {
      documentScrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      paneScrollWidth: pane ? pane.scrollWidth : null,
      paneClientWidth: pane ? pane.clientWidth : null,
    };
  });
}

export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const box = await measureOverflow(page);
  expect(
    box.documentScrollWidth,
    `${label}: document.documentElement.scrollWidth ${box.documentScrollWidth} vs innerWidth ${box.innerWidth}`,
  ).toBeLessThanOrEqual(box.innerWidth);
  if (box.paneScrollWidth !== null) {
    expect(
      box.paneScrollWidth,
      `${label}: the content pane scrolls sideways: scrollWidth ${box.paneScrollWidth} vs clientWidth ${box.paneClientWidth}`,
    ).toBeLessThanOrEqual(box.paneClientWidth ?? 0);
  }
}
