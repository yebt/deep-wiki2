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

    // M3's Filled card: `surface-container-highest`, elevation 0, no
    // outline (§9.4's table maps it to `UCard variant="soft"`, retargeted
    // to `bg-emphasized`). Nuxt UI ships `soft` as `bg-elevated/50` —
    // alpha over an unknown ground, the §12.8 defect — which also left
    // it tonally indistinguishable from the pane behind it.
    card: {
      variants: {
        variant: {
          soft: {
            root: 'bg-emphasized divide-y divide-default',
          },
        },
      },
    },

    // docs/UI-CHECKLIST.md §5 asks that required fields be conveyed
    // programmatically; it does not ask for a glyph on every label. When
    // every field on a form is required, an asterisk on each one carries
    // no information — the form states the rule once instead. The
    // `required` prop stays on the field (it is the semantic
    // declaration, and it is what this variant keys off); only its
    // decorative `::after` glyph is suppressed, centrally, so no screen
    // has to remember to. `content-none` is what removes it — the
    // sibling `after:*` utilities are inert without content.
    formField: {
      slots: {
        // §9.5: the label is `body-large` on `on-surface-variant`. The
        // library defaults to its own 14px, one step below the input text
        // it labels. `text-base` rather than `text-body-large` for the same
        // tailwind-merge reason documented on `authForm.description` below.
        label: 'text-base text-muted',
      },
      variants: {
        required: {
          true: {
            label: 'after:content-none',
          },
        },
      },
    },

    // M3 outlined text field (§9.5). Nuxt UI's defaults render a 32px-tall
    // field with 14px text and a 12px radius; M3 specifies a 56dp field,
    // `body-large` text and `corner-extra-small`. The 16px is the one that
    // is not a preference: below 16px, iOS Safari zooms the viewport on
    // focus, which §9.5 records as non-negotiable and which no amount of
    // desktop review would surface.
    input: {
      slots: {
        base: 'h-14 rounded-xs',
      },
      // The size variant sets the font size and is applied after the slot
      // override, so `text-base` on `base` loses to it. `xl` is the size
      // whose text is 16px; the height comes from the slot above, because
      // no library size is M3's 56dp.
      defaultVariants: {
        size: 'xl',
      },
    },

    // The one-line form-level note that replaces the per-field
    // asterisks. `UAuthForm` centres its header and sets it at 16px; this
    // is supporting text for the fields below it, so it reads
    // left-aligned and one step quieter than the 16px input text.
    authForm: {
      slots: {
        header: 'text-start',
        // Nuxt UI's own internal scale, deliberately, not a project
        // `--text-*` role: slot overrides are resolved by tailwind-merge,
        // which has no knowledge of this project's `--text-*` tokens and
        // therefore reads `text-body-small` as a text *colour*. It would
        // drop it against the neighbouring `text-muted` and silently
        // leave the library's `text-base` in place, rendering this note
        // larger than the field labels under it. `text-sm` is one of the
        // classes tailwind-merge does understand, and using the library's
        // internal scale inside the library's own slot is sanctioned by
        // docs/DESIGN-SYSTEM.md §2.5.
        description: 'text-sm text-muted',
      },
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
        // `UFooter` renders its slots right → center → left in the DOM
        // so that `lg:order-1/2/3` can put them back in reading order on
        // wide viewports. Below `lg` the container is not a flex box at
        // all, so DOM order wins and the brand ends up *under* the
        // trailing meta. Making the container a reversed column at every
        // width below `lg` restores left → center → right; `lg:flex-row`
        // hands it back to the library's own ordering. The `mt-3` the
        // theme puts on the (previously last) left and center slots is
        // dropped in favour of one `gap-y-3` on the container, so the
        // spacing does not depend on which item happens to be first.
        container: 'flex flex-col-reverse gap-y-3 lg:flex-row',
        left: 'mt-0',
        center: 'mt-0',
      },
    },

    // Overlays sit one rung above the panes they cover (§9.6).
    dropdownMenu: { slots: { content: 'bg-accented' } },
    modal: { slots: { content: 'bg-accented' } },
    popover: { slots: { content: 'bg-accented' } },
  },
});
