/**
 * Nuxt UI design tokens for the deep-wiki Material Design 3 layer.
 *
 * Authority: docs/DESIGN-SYSTEM.md. `main.css` carries the tone tables,
 * the surface ladder, the type scale and the shape scale; this file
 * carries the three corrections that must be made to Nuxt UI's *component*
 * defaults, centrally, so no screen ever repeats them.
 *
 * Read §5.2 ("The two genuine conflicts, and the rulings"), §9.1 and §12.2
 * before touching anything here.
 */

/** The chromatic aliases. `neutral` is deliberately absent — it is not a
 *  chromatic alias and Nuxt UI styles it off the surface ladder instead. */
const CHROMATIC = ['primary', 'secondary', 'success', 'info', 'warning', 'error'] as const;

/**
 * DESIGN-SYSTEM §5.2 — the M3 state layer, expressed as Nuxt UI itself
 * expresses it on `UTree` and `UNavigationMenu`: an absolutely positioned
 * `before:` pseudo-element behind the content, filled with the element's
 * *content* colour, at M3's fixed per-state opacities.
 *
 *   hover 0.08 · focus 0.12 · pressed 0.12   (§5.1)
 *
 * This single mechanism resolves both of §5.2's stated conflicts:
 *
 *  1. "There is no pressed state." Nuxt UI sets `hover:` and `active:` to
 *     the same value on every chromatic variant, so pressing a button
 *     produces no feedback at all. Here hover and pressed are 0.08 and
 *     0.12 — distinct, and distinct on every variant at once.
 *
 *  2. "`solid` uses alpha, which is backwards in dark themes."
 *     `hover:bg-primary/75` makes the fill translucent and lets the page
 *     show through: it lightens on a light ground and darkens on a dark
 *     one, which violates checklist §4.2. The variant overrides below
 *     restore every fill to full opacity, and the state layer replaces it
 *     with a layer of `currentColor` — which *is* the `on-` role, and
 *     therefore already carries M3's direction in each theme: white over
 *     `primary` tone 40 in light, tone 20 over `primary` tone 80 in dark.
 *
 * Deviation from §5.2's literal ruling, recorded here because
 * docs/DESIGN-SYSTEM.md is not this agent's to edit: that section proposes
 * stepping the *shade* for `solid` (`hover:bg-primary-500
 * active:bg-primary-400`). Measured against these tone tables, the pressed
 * step lands white label text on tone 60 at 3.15:1 — below the checklist
 * §5 floor of 4.5:1, which is pass/fail and wins on conflict (§0). The
 * cause is granularity: one shade slot is ten M3 tones, where an 0.12
 * state layer is worth about four. Compositing the layer reproduces M3's
 * intended result exactly and leaves the label's contrast untouched.
 */
const STATE_LAYER = [
  'relative isolate',
  'before:absolute before:inset-0 before:-z-10',
  // The layer follows the M3 Expressive shape morph on press (§3.3).
  'before:rounded-md active:before:rounded-sm',
  'before:bg-current before:opacity-0',
  'before:transition-opacity before:duration-100 before:ease-standard',
  'hover:before:opacity-8 focus-visible:before:opacity-12 active:before:opacity-12',
  'disabled:before:opacity-0 aria-disabled:before:opacity-0',
].join(' ');

/**
 * Neutralises Nuxt UI's alpha-modulated hover/active fills so the state
 * layer above is the only thing that moves. Each entry restates the rest
 * fill at full opacity for both interactive states; tailwind-merge keeps
 * the last declaration, and app-config compound variants are appended
 * after the library's own.
 */
const buttonCompoundVariants = [
  ...CHROMATIC.flatMap((color) => [
    // M3 Filled: `primary` + `on-primary`, opaque in every state.
    {
      color,
      variant: 'solid' as const,
      class: `bg-${color} text-inverted hover:bg-${color} active:bg-${color}`,
    },
    // M3 Outlined: a 1px boundary in the `outline` role. Nuxt UI's
    // `ring-${color}/50` is alpha on a control boundary — §12.8.
    {
      color,
      variant: 'outline' as const,
      class: `ring ring-inset ring-${color} hover:bg-transparent active:bg-transparent`,
    },
    // M3 Filled tonal: the opaque container tokens, never `bg-${color}/10`
    // over an unknown background (§9.1, §12.8).
    {
      color,
      variant: 'soft' as const,
      class: `bg-${color}-container text-on-${color}-container hover:bg-${color}-container active:bg-${color}-container`,
    },
    {
      color,
      variant: 'subtle' as const,
      class: `bg-${color}-container text-on-${color}-container ring ring-inset ring-${color}-300 dark:ring-${color}-600 hover:bg-${color}-container active:bg-${color}-container`,
    },
    // M3 Text button.
    {
      color,
      variant: 'ghost' as const,
      class: `hover:bg-transparent active:bg-transparent`,
    },
    {
      color,
      variant: 'link' as const,
      class: `hover:text-${color} active:text-${color}`,
    },
  ]),
  // Neutral walks the surface ladder rather than an accent palette (§5.2).
  { color: 'neutral' as const, variant: 'solid' as const, class: 'hover:bg-inverted active:bg-inverted' },
  { color: 'neutral' as const, variant: 'outline' as const, class: 'hover:bg-default active:bg-default' },
  { color: 'neutral' as const, variant: 'soft' as const, class: 'hover:bg-elevated active:bg-elevated' },
  { color: 'neutral' as const, variant: 'subtle' as const, class: 'hover:bg-elevated active:bg-elevated' },
  { color: 'neutral' as const, variant: 'ghost' as const, class: 'hover:bg-transparent active:bg-transparent' },
  { color: 'neutral' as const, variant: 'link' as const, class: 'hover:text-muted active:text-muted' },
];

/** Badges are M3 chips: a labelled container, never an alpha tint (§9.7). */
const badgeCompoundVariants = [
  ...CHROMATIC.flatMap((color) => [
    {
      color,
      variant: 'soft' as const,
      class: `bg-${color}-container text-on-${color}-container`,
    },
    {
      color,
      variant: 'subtle' as const,
      class: `bg-${color}-container text-on-${color}-container ring ring-inset ring-${color}-300 dark:ring-${color}-600`,
    },
  ]),
];

export default defineAppConfig({
  ui: {
    /**
     * Every alias points at a hand-authored M3 tonal palette in
     * `main.css`. A stock Tailwind palette is not a tonal palette — its
     * lightness steps do not land on M3's tones (§1.4).
     */
    colors: {
      primary: 'dw-primary',
      secondary: 'dw-secondary',
      success: 'dw-success',
      info: 'dw-info',
      warning: 'dw-warning',
      error: 'dw-error',
      neutral: 'dw-neutral',
    },

    button: {
      slots: {
        // M3 Expressive's press affordance: the corner *shrinks* on press,
        // 12px → 8px, which is `rounded-md` → `rounded-sm` on this radius
        // ladder (§3.3). Paired with the state layer above.
        base: `${STATE_LAYER} transition-[border-radius,background-color,color] duration-100 ease-standard active:rounded-sm`,
      },
      compoundVariants: buttonCompoundVariants,
    },

    badge: {
      compoundVariants: badgeCompoundVariants,
    },

    // The top app bar is `surface-container`, elevation 0, no shadow
    // (§9.3). Nuxt UI ships it as a translucent `bg-default/75`, which is
    // alpha over an unknown ground — §12.8 — and leaves it tonally
    // identical to the document canvas.
    header: {
      slots: {
        root: 'bg-elevated border-b border-default',
      },
    },

    footer: {
      slots: {
        root: 'bg-elevated border-t border-default',
      },
    },

    // Overlays sit one rung above the panes they cover (§9.6).
    dropdownMenu: { slots: { content: 'bg-accented' } },
    modal: { slots: { content: 'bg-accented' } },
    popover: { slots: { content: 'bg-accented' } },
  },
});
