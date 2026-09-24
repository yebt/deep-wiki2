import type { Locator } from '@playwright/test';

/**
 * Measures, in the running browser, the WCAG contrast between a control's
 * *visible boundary* and the surface it sits on — the number
 * docs/UI-CHECKLIST.md §5 fixes at 3:1 for "the boundary of interactive
 * controls". A token name is not a measurement: the 2026-09-14 audit found
 * `variant="soft"` controls at **1.02:1**, **1.00:1** and **1.09:1** on the
 * surfaces they actually rendered on, while every token involved was the
 * right one. Only a computed colour can catch that.
 *
 * The boundary is whichever the control actually draws: an inset ring
 * (Tailwind's `ring` is a `box-shadow`) when it has one, otherwise the
 * edge of its own fill. The ground is the nearest ancestor that paints an
 * opaque background. Colours are resolved through a 1x1 canvas so `rgb()`
 * and `oklch()` serialisations measure the same way.
 */
export async function boundaryContrast(control: Locator): Promise<number> {
  return control.evaluate((element) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;

    function toRgba(css: string): [number, number, number, number] {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = css;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!, a! / 255];
    }

    function luminance([r, g, b]: [number, number, number, number]): number {
      const channel = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    /** Tailwind composes `box-shadow` from five slots (inset shadow, inset ring, ring offset, ring, shadow), most of them transparent placeholders — the drawn ring is the first shadow whose colour is not fully transparent. */
    function drawnShadowColour(shadow: string): string | null {
      const shadows: string[] = [];
      let depth = 0;
      let current = '';
      for (const char of shadow) {
        if (char === '(') depth += 1;
        if (char === ')') depth -= 1;
        if (char === ',' && depth === 0) {
          shadows.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      if (current.trim()) shadows.push(current.trim());
      for (const entry of shadows) {
        const match = /^(rgba?\([^)]*\)|oklch\([^)]*\)|oklab\([^)]*\)|color\([^)]*\)|#[0-9a-fA-F]+|[a-zA-Z]+)/.exec(entry);
        if (match && toRgba(match[1]!)[3] > 0) return match[1]!;
      }
      return null;
    }

    const style = getComputedStyle(element);
    let boundary: [number, number, number, number] | null = null;
    if (style.boxShadow !== 'none') {
      const colour = drawnShadowColour(style.boxShadow);
      if (colour) boundary = toRgba(colour);
    }
    if (!boundary || boundary[3] === 0) boundary = toRgba(style.backgroundColor);
    if (boundary[3] === 0) throw new Error('the control draws neither a ring nor a fill — nothing to measure');

    let ground: [number, number, number, number] | null = null;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const candidate = toRgba(getComputedStyle(node).backgroundColor);
      if (candidate[3] > 0) {
        ground = candidate;
        break;
      }
    }
    if (!ground) ground = toRgba(getComputedStyle(document.body).backgroundColor);

    const lighter = Math.max(luminance(boundary), luminance(ground));
    const darker = Math.min(luminance(boundary), luminance(ground));
    return (lighter + 0.05) / (darker + 0.05);
  });
}

/**
 * Measures the contrast between a block's own **text colour** and the colour
 * a highlight paints **behind** it — docs/UI-CHECKLIST.md §5's 4.5:1 floor
 * for body text, on a pair no single element carries.
 *
 * The comment highlight is drawn as absolutely positioned boxes behind the
 * article (`useAnchorHighlight`), so neither element knows about the other:
 * the text's `color` is on the block, the fill is on the box, and the
 * composited result exists only on screen. Both are read in the running
 * browser and composited here, which is the only honest way to assert that
 * a reader can still read the sentence a comment points at (added
 * 2026-09-23, with the anchored-span highlight).
 */
export async function textContrastOver(text: Locator, fill: Locator): Promise<number> {
  const textColour = await text.evaluate((element) => getComputedStyle(element).color);
  return fill.evaluate(
    (element, colour) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;

      function toRgb(css: string): [number, number, number] {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!];
      }

      function luminance([r, g, b]: [number, number, number]): number {
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      }

      const foreground = luminance(toRgb(colour));
      const background = luminance(toRgb(getComputedStyle(element).backgroundColor));
      const lighter = Math.max(foreground, background);
      const darker = Math.min(foreground, background);
      return (lighter + 0.05) / (darker + 0.05);
    },
    textColour,
  );
}
