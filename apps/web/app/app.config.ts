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
 * What `soft` (M3's Filled tonal) means on a container — decided once,
 * here, after the 2026-09-14 audit measured it three times on three
 * surfaces and found it invisible on all of them:
 *
 *   "Start editing" on a `PageNotice`        1.02:1   (§9.4's Filled card, tone 90)
 *   "Edit" on the app bar                    1.09:1   (`bg-elevated`, tone 94)
 *   a diff badge on its own `*-container` row 1.00:1  (the very same token)
 *
 * The cause is structural, not a wrong token: the tonal fill is
 * `<color>-container` at tone 90 light / 30 dark (§1.2), and the surfaces
 * a wiki actually puts its controls on sit at tones 90–94 / 17–24 (§1.4).
 * A fill a few tones from its ground has no edge, and there is no rung
 * above `bg-emphasized` to escape to (§1.4 forbids a sixth surface level)
 * — the same "invisible by construction" collision §9.5 records for the
 * filled text field on the Filled card, arriving one component later.
 * Checklist §5 fixes the boundary of an interactive control at 3:1 and
 * wins on conflict (§0), so M3's outline-less tonal button is the rule
 * that yields.
 *
 * **Ruling: tonal carries its boundary in the `outline` role** — a 1px
 * inset ring in the accent colour itself (`ring-<color>`), the ground-
 * independent boundary §9.5 gives the outlined text field and §9.1 gives
 * the Outlined button. It is not a shade step (`ring-<color>-300` /
 * `-600`, what `subtle` used to draw, measured 1.77:1 / 1.50:1 against the
 * fill) and not a tone step of the fill (tone 80 on tone 90 is 1.33:1, and
 * anything darker fails the label). Measured from the tone tables in
 * `main.css` with the accent at tone 40 light / 70 dark: the ring is
 * ≥ 4.47:1 against the fill and ≥ 4.77:1 against every surface rung, in
 * both themes, for every chromatic alias — while the label stays the
 * `on-container` pair at ≥ 7.3:1. `e2e/read.spec.ts` measures the app
 * bar's "Edit" in the running browser in both themes, so this cannot
 * regress by a token rename.
 *
 * Applies to `UButton` and `UBadge` alike: M3's chip is *outlined* by
 * default (§9.7 maps `UBadge` to the chip), so the ring on a badge is
 * M3's own shape, and it is what lets a diff badge read as a chip on a
 * row painted the same colour.
 *
 * A tonal control therefore never needs a surface-aware call site: it is
 * legible on every rung, and a screen chooses `soft` for emphasis, never
 * for ground.
 */
const TONAL_BOUNDARY = 'ring ring-inset';
const tonalFill = (color: string) => `bg-${color}-container text-on-${color}-container ${TONAL_BOUNDARY} ring-${color}`;

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
    // over an unknown background (§9.1, §12.8) — plus the `outline`-role
    // boundary `TONAL_BOUNDARY` explains. `subtle` is Nuxt UI's
    // "soft plus a ring"; with the ring now part of what tonal *means*,
    // the two variants are one treatment.
    {
      color,
      variant: 'soft' as const,
      class: `${tonalFill(color)} hover:bg-${color}-container active:bg-${color}-container`,
    },
    {
      color,
      variant: 'subtle' as const,
      class: `${tonalFill(color)} hover:bg-${color}-container active:bg-${color}-container`,
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

/**
 * DESIGN-SYSTEM §7.4 — the horizontal half of M3's text-field rhythm.
 * `md-comp-outlined-field` insets its content 16dp from the container edge
 * (`leading-space` / `trailing-space: 16px`); Nuxt UI's `xl` ships 12px.
 * Shared so the whole text-field family carries one inset.
 */
const FIELD_INSET = { base: 'px-4', leading: 'ps-4', trailing: 'pe-4' } as const;

/** Badges are M3 chips: a labelled container, never an alpha tint (§9.7), with the same `outline`-role boundary as a tonal button — see `TONAL_BOUNDARY`. */
const badgeCompoundVariants = [
  ...CHROMATIC.flatMap((color) => [
    { color, variant: 'soft' as const, class: tonalFill(color) },
    { color, variant: 'subtle' as const, class: tonalFill(color) },
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
      // §7.2's density table names three button heights — 32px for chrome,
      // 40px for content-area and primary actions — and maps each onto a
      // Nuxt UI `size`. Measured against the installed v4.11.0 theme, none
      // of those mappings is true: `sm` renders 28px (py-1.5 + 16px line),
      // `md` 32px, `lg` 36px. Only `xl` reaches 40px, and it does so by
      // taking the label to 16px, one step above M3's `label-large`.
      //
      // This is §9.5's trap in a second component: a size variant is a
      // calibrated bundle of padding *and* font size, so the height cannot
      // be had by choosing a size — it has to be stated. Naming it here is
      // what makes §7.2's table describe the buttons this app actually
      // renders, and it is the reason no auth screen carries a `size` prop.
      //
      // `min-h-*` rather than `h-*`: a button's label can wrap (a long
      // action in a narrow pane, a translated string, 200% zoom), and a
      // fixed height would clip it — checklist §6.
      variants: {
        size: {
          sm: { base: 'min-h-8' }, // chrome / toolbars — §7.2
          md: { base: 'min-h-10' }, // content-area actions — §7.2
          lg: { base: 'min-h-10' }, // primary action; §7.2 distinguishes it by variant, not size
        },
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
        // §7.4 — M3's field puts its supporting text 4dp below the
        // container (`supporting-text-top-space: 4px`). The library
        // default is 8px, which is the *label* distance; using the same
        // number above and below the field makes the trio read as three
        // unrelated lines instead of one object.
        error: 'mt-1',
        help: 'mt-1',
      },
      variants: {
        required: {
          true: {
            label: 'after:content-none',
          },
        },
        // §7.4 — 8dp from the label to the field it names, M3's
        // `label-text-padding-bottom`. The library ships `mt-1` (4px),
        // which is M3's *supporting-text* distance and the tightest space
        // in the whole field spec; at 4px the label reads as floating
        // between two fields rather than belonging to the one under it.
        // Overridden on the variant, not the slot: `orientation.vertical`
        // sets `container` and variants resolve after slots, so a slot
        // override of the same property loses.
        orientation: {
          vertical: {
            container: 'mt-2',
          },
        },
      },
    },

    // M3 outlined text field (§9.5). Nuxt UI's defaults render a 32px-tall
    // field with 14px text; M3 specifies a 56dp field and `body-large`
    // text. The 16px is the one that is not a preference: below 16px, iOS
    // Safari zooms the viewport on focus, which §9.5 records as
    // non-negotiable and which no amount of desktop review would surface.
    //
    // Shape is `rounded-md` — 12px, `corner-medium` — and NOT M3's literal
    // `corner-extra-small` (4px). Recorded deviation, §9.5 and §14
    // (2026-09-06). M3's 4px field is calibrated against an M3 button at
    // `corner-full`: the two are meant to read as different kinds of
    // object, and the enormous gap between them is the signal. This
    // project already deviates the other way — §3.3 pulls buttons down to
    // `corner-medium` for a dense keyboard-driven tool — and a 4px field
    // beside a 12px button inside a 16px card is the residue of that
    // earlier decision, not of M3. Completing it gives the screen two
    // shape idioms instead of three: controls at `corner-medium`,
    // containers at `corner-large`, still ordered so shape identifies the
    // component. 12px is also below M3 Expressive's own square shape for a
    // 56dp-tall control (16px), so this is the conservative direction.
    input: {
      slots: {
        base: 'h-14 rounded-md',
      },
      // §7.4 — M3's outlined field insets its content 16dp from the
      // container edge (`leading-space`/`trailing-space: 16px`). Nuxt UI's
      // `xl` ships 12px, which is the one horizontal number on this screen
      // that is not a 4dp step off the card's own 24px inset. Stated on
      // the size variant for the reason recorded above `defaultVariants`:
      // the variant resolves after the slot, so `px-4` written on `base`
      // would lose to the variant's `px-3`.
      variants: {
        size: { xl: FIELD_INSET },
      },
      // The size variant sets the font size and is applied after the slot
      // override, so `text-base` on `base` loses to it. `xl` is the size
      // whose text is 16px; the height comes from the slot above, because
      // no library size is M3's 56dp.
      defaultVariants: {
        size: 'xl',
      },
    },

    // The rest of the text-field family. Nuxt UI already ships every one
    // of these at `rounded-md`, so the shape ruling above needs no
    // restating here — but none of them defaults to 16px text, and the
    // iOS-zoom rule is a property of any text-entry control, not of
    // `UInput` specifically. Setting the size default centrally is what
    // stops the next form that reaches for a `USelect` from silently
    // reintroducing the defect §9.5 already caught once.
    //
    // `h-14` goes only on the single-line controls. A textarea's height is
    // its `rows`, and `UInputTags` grows as tags wrap; pinning either to
    // 56px would clip its own content.
    //
    // The 16dp content inset (§7.4) travels with them for the same
    // reason: it is a property of M3's field, not of `UInput`.
    textarea: { variants: { size: { xl: { base: 'px-4' } } }, defaultVariants: { size: 'xl' } },
    inputTags: { variants: { size: { xl: { base: 'px-4' } } }, defaultVariants: { size: 'xl' } },
    select: { slots: { base: 'h-14' }, variants: { size: { xl: FIELD_INSET } }, defaultVariants: { size: 'xl' } },
    selectMenu: { slots: { base: 'h-14' }, variants: { size: { xl: FIELD_INSET } }, defaultVariants: { size: 'xl' } },
    inputMenu: { slots: { base: 'h-14' }, variants: { size: { xl: FIELD_INSET } }, defaultVariants: { size: 'xl' } },
    inputNumber: { slots: { base: 'h-14' }, variants: { size: { xl: FIELD_INSET } }, defaultVariants: { size: 'xl' } },

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
        // §7.4 — 24dp between stacked field groups, and between the last
        // field and the submit action. The library ships `space-y-5`
        // (20px): on-grid, but the only 20px rhythm on a screen whose
        // every other step is 24 — the card's padding, the header-to-body
        // gap, the submit-to-footer gap. It is also too little to hold a
        // field group that has grown: a validation message is 4px of
        // supporting-text space plus a 20px line, so an invalid field
        // consumed the entire gap and left its error touching the next
        // field's label.
        form: 'space-y-6',
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

    // `UMain`'s own base is `min-h-[calc(100vh-var(--ui-header-height))]`
    // — viewport minus the header, with no allowance for a `UFooter`
    // below it. Any screen pairing the two overflows by exactly the
    // footer's height — 49px at 1280x900, on content that fits several
    // times over — and carries permanent vertical scroll. This is the
    // defect `AuthShell` first patched per-instance (docs/UI-CHECKLIST.md
    // review log, 2026-09-04), which left `/` — the one screen that did
    // not use the shell — still scrolling. Fixed here, centrally, so
    // `AppShell` and every screen built on it never have to restate it:
    // `flex-1` takes whatever space is actually left instead of a
    // calculation that does not know the footer exists, and `min-h-0`
    // lets that flex child shrink and scroll its own content instead of
    // forcing the whole column taller than the viewport.
    //
    // It is correct only inside `AppShell`'s `min-h-svh` column, which is
    // why that column is likewise stated once and every route renders
    // inside it (docs/UI-CHECKLIST.md §6).
    main: {
      base: 'flex min-h-0 flex-1 flex-col',
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
