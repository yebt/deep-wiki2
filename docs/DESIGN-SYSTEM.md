# Visual Design System — Material Design 3, translated to Nuxt UI v4

> Living document. This file is the **aesthetic system**: what things look like, and why.
> It is the counterpart to [`docs/UI-CHECKLIST.md`](./UI-CHECKLIST.md), which is the **gate**.

---

## 0. How to use this file

### Its relationship to the UI checklist

| | `docs/UI-CHECKLIST.md` | `docs/DESIGN-SYSTEM.md` (this file) |
| --- | --- | --- |
| **Question it answers** | Is this screen *correct*? | Does this screen *look like the product*? |
| **Governs** | Required states, accessibility floor, responsive behaviour, keyboard, e2e coverage, permission states | Colour roles, type scale, shape, elevation, state layers, motion, spacing, density, component selection |
| **Verdict** | Pass / fail. A fail blocks the review. | Consistency. A deviation must be deliberate and recorded. |
| **Mode** | Checkbox audit | Reference and rules |

The checklist assumes an aesthetic system exists. This is that system.

**On conflict, the checklist wins** — on correctness, accessibility, and responsive behaviour. Concretely: if an M3 rule in this file would produce a contrast ratio below the checklist's §5 floor, a target smaller than 24×24 CSS px, a focus ring that disappears in some theme, or a breakpoint behaviour that contradicts §6, the checklist's rule applies and this file is wrong. Record the correction here.

Where this file wins: anything the checklist does not speak to. The checklist says "real typographic hierarchy"; this file says *which* type roles, at which sizes. The checklist says "every visual value resolves to a token"; this file says *which* tokens exist and what each is for.

### The standing rule still applies

The checklist's §1 standing rule — **extend the system, do not invent one** — outranks this document too. Nuxt UI v4 is the system. Material Design 3 is the *reasoning* applied to it. Every rule below is expressed as a Nuxt UI or Tailwind v4 primitive, never as a parallel component set.

### How to read a section

Every section has the same shape:

1. **The M3 rule** — the concept, with the real token names and numeric values.
2. **In this stack** — how it is expressed in Tailwind v4 `@theme`, Nuxt UI `app.config.ts`, or Nuxt UI component props.
3. **Do / don't** — the short version.

A rule an implementer cannot act on in Nuxt UI is not in this file.

### What this stack is, and is not

This project uses **Nuxt UI v4 (Tailwind CSS v4 / Reka UI)**. It does **not** use Material Web Components, Jetpack Compose Material 3, or `material-color-utilities` at runtime. M3 is a source of design decisions here, not a dependency.

Verified facts about the installed stack that shape everything below:

| Fact | Value |
| --- | --- |
| Nuxt UI version | `4.11.0` |
| Nuxt UI Pro | Merged into free `@nuxt/ui` in v4, MIT. There is no Pro tier; all `UDashboard*`, `UPage*`, `USplitter` components are available. |
| Stylesheet entry | `apps/web/app/assets/css/main.css` → `@import "tailwindcss";` then `@import "@nuxt/ui";` |
| Dark mode | Class-driven. Nuxt UI defines `@variant dark (&:where(.dark, .dark *));` itself. **Do not write your own `@custom-variant dark`.** |
| Spacing base | Tailwind `--spacing: 0.25rem` (4px) |
| Radius base | `--ui-radius: 0.25rem` (see §4 — this project overrides it) |
| Colour aliases | `primary` `secondary` `success` `info` `warning` `error` + `neutral` |

M3 reference version for the token values below: Material 3 design system v0.192 tokens (`material-components/material-web`), plus the 2025 **Material 3 Expressive** additions taken from `androidx.compose.material3` tokens.

---

## 1. Colour

### 1.1 The M3 rule — tonal palettes and the 0–100 tone scale

M3 does not start from a set of hex values. It starts from a **source colour**, from which five (six with error) **tonal palettes** are generated: primary, secondary, tertiary, neutral, neutral-variant, error. Each palette is the same hue and chroma sampled across a **0–100 lightness tone scale**, where `0` is black and `100` is white.

The reference palette ships these tones:

| Palette | Tones present |
| --- | --- |
| primary / secondary / tertiary / error | 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100 |
| neutral-variant | 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100 |
| neutral | the above **plus** 4, 6, 12, 17, 22, 24, 87, 92, 94, 96, 98 |

The extra neutral tones exist for exactly one purpose: the surface-container ladder in §1.3. They are not decorative.

How the palettes derive from the source colour depends on the **scheme variant** — M3 ships `TONAL_SPOT` (the default), `NEUTRAL`, `VIBRANT`, `EXPRESSIVE`, `FIDELITY`, `CONTENT`, `RAINBOW`, `FRUIT_SALAD`, `MONOCHROME`. `TONAL_SPOT` keeps low-to-medium colourfulness with a tertiary hue related to the source. `EXPRESSIVE` is *intentionally detached* from the source colour, which is why an M3 Expressive theme can produce a palette whose hue never visibly appears.

The point for this project: **a theme is a tone table, not a colour list.** A theme author picks a source colour and produces tones; the roles below then read tones by name.

### 1.2 The colour roles — what each one is FOR

A role is a *job*, not a colour. Every role has a companion `on-` role guaranteed to be legible on it.

**Accent roles**

| Role | Tone (light) | Tone (dark) | What it is for |
| --- | --- | --- | --- |
| `primary` | 40 | 80 | The single most important action or emphasis on a screen. Sparse by design. |
| `on-primary` | 100 | 20 | Text/icons drawn on `primary`. |
| `primary-container` | 90 | 30 | A *quieter* primary emphasis: a filled-tonal button, a selected nav item, a highlighted block. Lower attention than `primary`, still clearly "the accent". |
| `on-primary-container` | 30 | 90 | Text/icons on `primary-container`. |
| `secondary` | 40 | 80 | Less prominent components; supporting accents. In practice, rarely used raw. |
| `secondary-container` | 90 | 30 | The workhorse of M3. Selected states, filter chips, nav active indicators. |
| `on-secondary-container` | 30 | 90 | Text/icons on `secondary-container`. |
| `tertiary` | 40 | 80 | A contrasting accent used to balance primary/secondary; for expressive moments. |
| `tertiary-container` | 90 | 30 | Same role as `secondary-container`, different hue. |
| `error` | 40 | 80 | Destructive and invalid state. |
| `on-error` | 100 | 20 | Text on `error`. |
| `error-container` | 90 | 30 | Error banners, invalid field backgrounds. |
| `on-error-container` | 30 | 90 | Text on `error-container`. |

**Surface roles**

| Role | Tone (light) | Tone (dark) | What it is for |
| --- | --- | --- | --- |
| `surface` | 98 | 6 | The default ground the app sits on. |
| `surface-dim` | 87 | 6 | The dimmest the surface gets. |
| `surface-bright` | 98 | 24 | The brightest the surface gets. |
| `surface-container-lowest` | 100 | 4 | The *recessed* end of the container ladder. |
| `surface-container-low` | 96 | 10 | |
| `surface-container` | 94 | 12 | The default container fill. |
| `surface-container-high` | 92 | 17 | |
| `surface-container-highest` | 90 | 22 | The *raised* end of the container ladder. |
| `on-surface` | 10 | 90 | Primary body and heading text. |
| `on-surface-variant` | 30 | 80 | Secondary/supporting text, inactive icons. The muted text role. |
| `outline` | 50 | 60 | Borders that must be *seen* — a text field outline, a control boundary. Meets 3:1. |
| `outline-variant` | 80 | 30 | Decorative separators — a divider between list rows, a card edge. Deliberately below 3:1; it is not a control boundary. |
| `inverse-surface` | 20 | 90 | Snackbars, plain tooltips: surfaces that must read as *not part of* the page. |
| `inverse-on-surface` | 95 | 20 | Text on `inverse-surface`. |
| `inverse-primary` | 80 | 40 | An accent that stays legible on `inverse-surface` — e.g. a snackbar's action label. |
| `scrim` | 0 | 0 | Modal backdrop, always applied with opacity. |
| `shadow` | 0 | 0 | Shadow colour. |
| `surface-tint` | 40 | 80 | Legacy. See §5 — deprecated in favour of the container ladder. |

The deprecated roles you will see in older M3 material and should **not** introduce here: `background`, `on-background`, `surface-variant`.

### 1.3 Why surface-container levels instead of elevation shadows

This is the single most consequential idea in M3, and the most commonly missed.

Older Material expressed hierarchy with **drop shadows** and, in M2/early-M3, an opacity-based **surface tint overlay** whose strength was tied to an elevation value. Both were dropped. The current model:

> **Hierarchy is expressed by container tone, not by shadow.** A panel that sits "above" another panel is a *different tone of neutral*, not the same tone with a shadow under it.

Why this is better, and why it matters specifically for a wiki:

- **It survives dark themes.** A drop shadow is a dark smear. On a dark surface it is invisible. Tone separation works identically in both directions.
- **It survives large screens.** Elevation implies a floating object. A three-pane desktop shell has no floating objects — it has *regions*. Regions have tones.
- **It is not tied to elevation.** The old model made "raised" and "tinted" the same axis. Decoupling them means a persistently-visible sidebar can be tonally distinct without pretending to hover.
- **It gives you five discrete steps**, which is enough to build a real hierarchy and few enough that you cannot invent a sixth.

The ladder is symmetric between light and dark: in light, "higher" means *darker* (100 → 90); in dark, "higher" means *lighter* (4 → 22). Both directions move **away from the page ground**, so the same semantic ("this container is above that one") produces the correct visual result in both themes without a single conditional.

Shadows are not abolished; see §5 for the narrow case where one is still correct.

### 1.4 In this stack

Nuxt UI v4 has its own two-layer colour model. Understand it exactly, because everything else depends on it.

**Layer 1 — palette shades.** `app.config.ts` maps each alias to a Tailwind palette name:

```ts
// apps/web/app/app.config.ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'green',
      secondary: 'blue',
      success: 'green',
      info: 'blue',
      warning: 'yellow',
      error: 'red',
      neutral: 'slate'
    }
  }
})
```

At runtime this generates, for every alias and every shade in `[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]`:

```css
--ui-color-primary-500: var(--color-green-500);
/* …and so on for all 11 shades of all 7 aliases */
```

**Layer 2 — semantic values.** Nuxt UI then picks one shade per alias, per mode:

```css
:root, :host, .light { --ui-primary: var(--ui-color-primary-500); }
.dark                { --ui-primary: var(--ui-color-primary-400); }
```

and ships this complete, closed set of neutral-derived semantic variables:

| Variable | Light default | Dark default |
| --- | --- | --- |
| `--ui-text-dimmed` | `neutral-400` | `neutral-500` |
| `--ui-text-muted` | `neutral-500` | `neutral-400` |
| `--ui-text-toned` | `neutral-600` | `neutral-300` |
| `--ui-text` | `neutral-700` | `neutral-200` |
| `--ui-text-highlighted` | `neutral-900` | `#fff` |
| `--ui-text-inverted` | `#fff` | `neutral-900` |
| `--ui-bg` | `#fff` | `neutral-900` |
| `--ui-bg-muted` | `neutral-50` | `neutral-800` |
| `--ui-bg-elevated` | `neutral-100` | `neutral-800` |
| `--ui-bg-accented` | `neutral-200` | `neutral-700` |
| `--ui-bg-inverted` | `neutral-900` | `#fff` |
| `--ui-border` | `neutral-200` | `neutral-800` |
| `--ui-border-muted` | `neutral-200` | `neutral-700` |
| `--ui-border-accented` | `neutral-300` | `neutral-700` |
| `--ui-border-inverted` | `neutral-900` | `#fff` |
| `--ui-radius` | `0.25rem` | — |
| `--ui-container` | `80rem` | — |
| `--ui-header-height` | `4rem` | — |

That is the whole list. There is **no `--ui-neutral`** (neutral is excluded from the shorthand loop) and **no `--ui-border-elevated`**.

The utilities are named differently from the variables: `--ui-text` → `text-default`, `--ui-bg` → `bg-default`.

#### Mapping M3 tones onto Nuxt UI shades

The 11 Nuxt UI shade slots map monotonically onto 11 M3 tones:

| Nuxt UI shade | M3 tone |
| --- | --- |
| `50` | 95 |
| `100` | 90 |
| `200` | 80 |
| `300` | 70 |
| `400` | 60 |
| `500` | 50 |
| `600` | 40 |
| `700` | 30 |
| `800` | 20 |
| `900` | 10 |
| `950` | 0 |

M3 tones 98, 99 and 100 fall outside this ladder; they are carried by `--ui-bg` and `--ui-bg-muted` directly (see the surface table below), not by an accent palette.

**Rule:** a deep-wiki theme is authored by writing the 11 tones of each palette into a `@theme static` block, then pointing the aliases at it. Do not attempt to force a stock Tailwind palette to behave like an M3 tonal palette — the lightness steps do not line up.

> **An M3 tone is a CIE L\*, not an oklch lightness. Do not write `oklch(<tone>%)`.**
>
> The two scales coincide near white and diverge badly below tone 25. Written naively, tone 4 lands at L\* 0.4 — `#010202`, effectively pure black — so a dark surface container renders as a hole punched in the page instead of a container sitting on it. This is not hypothetical: it shipped, and the owner caught it on review (see §14, 2026-09-04).
>
> For a neutral, Oklab L is the cube root of relative luminance and CIE L\* → Y is the standard piecewise transform, so the conversion collapses to:
>
> ```
> tone  > 8  →  oklch L = (tone + 16) / 116
> tone <= 8  →  oklch L = cbrt(tone / 903.2963)
> ```
>
> The literal percentages in the block below are the *converted* values, not the tone numbers. If you regenerate a palette, run the conversion — do not transcribe tones.

```css
/* apps/web/app/assets/css/main.css — AFTER both imports */
@theme static {
  /* Tones of the primary tonal palette, generated once from the source colour.
     Shade slot ← M3 tone.  50←95  100←90  200←80  300←70  400←60
                            500←50 600←40 700←30 800←20 900←10 950←0 */
  --color-dw-primary-50:  oklch(96.0% 0.030 250);
  --color-dw-primary-100: oklch(92.0% 0.055 250);
  --color-dw-primary-200: oklch(84.0% 0.090 250);
  --color-dw-primary-300: oklch(75.0% 0.120 250);
  --color-dw-primary-400: oklch(66.0% 0.140 250);
  --color-dw-primary-500: oklch(57.0% 0.150 250);
  --color-dw-primary-600: oklch(48.0% 0.145 250);
  --color-dw-primary-700: oklch(38.5% 0.125 250);
  --color-dw-primary-800: oklch(29.0% 0.100 250);
  --color-dw-primary-900: oklch(19.5% 0.070 250);
  --color-dw-primary-950: oklch(0%    0     250);
}
```

```ts
// apps/web/app/app.config.ts
export default defineAppConfig({
  ui: { colors: { primary: 'dw-primary', neutral: 'dw-neutral' } }
})
```

`@theme static` is required for a custom palette: all 11 shades must be emitted, because Nuxt UI's generated `--ui-color-<alias>-<shade>` references `--color-<value>-<shade>` for every shade whether or not it is used in markup.

#### The accent role bridge

Nuxt UI gives you `--ui-primary` (one tone). M3 needs four (`primary`, `on-primary`, `primary-container`, `on-primary-container`). Re-point `--ui-primary` to the M3 tone, and register the container roles as project tokens so they generate real utilities.

```css
/* main.css, after the imports */

/* 1. Re-point Nuxt UI's accent to M3's tones.
      Nuxt UI defaults to shade 500 (tone 50) light / 400 (tone 60) dark.
      M3 says tone 40 light / tone 80 dark. */
:root, :host, .light {
  --ui-primary:   var(--ui-color-primary-600);   /* tone 40 */
  --ui-secondary: var(--ui-color-secondary-600);
  --ui-error:     var(--ui-color-error-600);
}
.dark {
  --ui-primary:   var(--ui-color-primary-200);   /* tone 80 */
  --ui-secondary: var(--ui-color-secondary-200);
  --ui-error:     var(--ui-color-error-200);
}

/* 2. The container roles M3 has and Nuxt UI does not. */
:root, :host, .light {
  --ui-primary-container:      var(--ui-color-primary-100);   /* tone 90 */
  --ui-on-primary-container:   var(--ui-color-primary-700);   /* tone 30 */
  --ui-secondary-container:    var(--ui-color-secondary-100);
  --ui-on-secondary-container: var(--ui-color-secondary-700);
  --ui-error-container:        var(--ui-color-error-100);
  --ui-on-error-container:     var(--ui-color-error-700);
}
.dark {
  --ui-primary-container:      var(--ui-color-primary-700);   /* tone 30 */
  --ui-on-primary-container:   var(--ui-color-primary-100);   /* tone 90 */
  --ui-secondary-container:    var(--ui-color-secondary-700);
  --ui-on-secondary-container: var(--ui-color-secondary-100);
  --ui-error-container:        var(--ui-color-error-700);
  --ui-on-error-container:     var(--ui-color-error-100);
}

/* 3. Register them so Tailwind emits utilities.
      `inline` is mandatory: the value is itself a var() that is redefined
      per theme, and without `inline` Tailwind resolves it once at :root. */
@theme inline {
  --color-primary-container:      var(--ui-primary-container);
  --color-on-primary-container:   var(--ui-on-primary-container);
  --color-secondary-container:    var(--ui-secondary-container);
  --color-on-secondary-container: var(--ui-on-secondary-container);
  --color-error-container:        var(--ui-error-container);
  --color-on-error-container:     var(--ui-on-error-container);
}
```

That yields `bg-primary-container`, `text-on-primary-container`, and so on — real utilities that follow the theme switch.

`text-inverted` already *is* `on-primary` in practice: it is `#fff` in light and `neutral-900` in dark, which is what M3 pairs with `primary` at tone 40 / tone 80 respectively. Use `bg-primary text-inverted` for the M3 primary/on-primary pair.

#### The surface ladder bridge

Nuxt UI's five `--ui-bg-*` values *are* a container ladder. Map M3's roles onto them and re-tune the tones:

| M3 role | Nuxt UI variable | Utility | Light tone | Dark tone | Used in deep-wiki for |
| --- | --- | --- | --- | --- | --- |
| `surface-container-lowest` | `--ui-bg` | `bg-default` | 100 | 4 | Document canvas, card faces, editor body |
| `surface` / `surface-container-low` | `--ui-bg-muted` | `bg-muted` | 98 | 10 | The app ground behind the panes |
| `surface-container` | `--ui-bg-elevated` | `bg-elevated` | 94 | 12 | Navigation tree, contextual panel, top app bar |
| `surface-container-high` | `--ui-bg-accented` | `bg-accented` | 92 | 17 | Menus, popovers, dialogs, command palette, search |
| `surface-container-highest` | `--ui-bg-emphasized` *(project token)* | `bg-emphasized` | 90 | 22 | Selected tree row, code block, pressed toggle |
| `inverse-surface` | `--ui-bg-inverted` | `bg-inverted` | 20 | 90 | Snackbars, plain tooltips |

**Defect in the stock dark theme — fix this once, centrally.** Nuxt UI's dark defaults set `--ui-bg-muted` and `--ui-bg-elevated` to the *same* value (`neutral-800`). Two of the five ladder rungs collapse, so a panel on the app ground has no tonal separation in dark mode. This is precisely the "flat dark UI" failure in §12. Every deep-wiki theme must re-tune the dark ladder:

```css
.dark {
  --ui-bg:           var(--dw-neutral-tone-4);
  --ui-bg-muted:     var(--dw-neutral-tone-10);
  --ui-bg-elevated:  var(--dw-neutral-tone-12);
  --ui-bg-accented:  var(--dw-neutral-tone-17);
  --ui-bg-emphasized:var(--dw-neutral-tone-22);
}
:root, :host, .light {
  --ui-bg:           #fff;                       /* tone 100 */
  --ui-bg-muted:     var(--dw-neutral-tone-98);
  --ui-bg-elevated:  var(--dw-neutral-tone-94);
  --ui-bg-accented:  var(--dw-neutral-tone-92);
  --ui-bg-emphasized:var(--dw-neutral-tone-90);
}
@theme inline {
  --background-color-emphasized: var(--ui-bg-emphasized);
}
```

The `--dw-neutral-tone-*` variables are the extra neutral tones from §1.1 (4, 10, 12, 17, 22, 90, 92, 94, 98). They exist *only* for this ladder and are set per theme.

#### Text and outline roles

| M3 role | Nuxt UI utility | Note |
| --- | --- | --- |
| `on-surface` | `text-highlighted` | Headings and emphasised body |
| `on-surface` (body) | `text-default` | Running text |
| `on-surface-variant` | `text-muted` | Supporting text, inactive icons, metadata |
| — | `text-dimmed` | Below M3's roles; use only for non-essential ornament, never for text that must be read |
| `outline` | `border-accented` / `ring-accented` | Control boundaries. Must hold 3:1 — see §11. |
| `outline-variant` | `border-default` / `divide-default` | Decorative separators only |

**Do**
- Author a theme as a tone table; write tones into `@theme static`, then alias.
- Pair every foreground with its matching `on-` role. `bg-primary` always takes `text-inverted`; `bg-primary-container` always takes `text-on-primary-container`.
- Express hierarchy by walking the `bg-default → bg-muted → bg-elevated → bg-accented → bg-emphasized` ladder.
- Fix the dark ladder collapse in every theme.

**Don't**
- Don't use a stock Tailwind palette as an M3 tonal palette. The steps do not correspond.
- Don't use `bg-primary/10` as a stand-in for `primary-container`. Alpha over an unknown background is exactly the class of defect checklist §4.2 exists to catch; an opaque container token is theme-safe, an alpha layer is not.
- Don't use `border-default` (`outline-variant`) as a text-field or button boundary. It is deliberately below 3:1.
- Don't introduce a sixth surface level.

---

## 2. Typography

### 2.1 The M3 rule — the type scale

Fifteen roles across five families. Values below are the v0.192 web tokens, verbatim.

| Role | Size | Line height | Weight | Tracking | Typeface slot |
| --- | --- | --- | --- | --- | --- |
| `display-large` | 3.5625rem / 57px | 4rem / 64px | 400 | −0.015625rem | brand |
| `display-medium` | 2.8125rem / 45px | 3.25rem / 52px | 400 | 0 | brand |
| `display-small` | 2.25rem / 36px | 2.75rem / 44px | 400 | 0 | brand |
| `headline-large` | 2rem / 32px | 2.5rem / 40px | 400 | 0 | brand |
| `headline-medium` | 1.75rem / 28px | 2.25rem / 36px | 400 | 0 | brand |
| `headline-small` | 1.5rem / 24px | 2rem / 32px | 400 | 0 | brand |
| `title-large` | 1.375rem / 22px | 1.75rem / 28px | 400 | 0 | brand |
| `title-medium` | 1rem / 16px | 1.5rem / 24px | 500 | 0.009375rem | plain |
| `title-small` | 0.875rem / 14px | 1.25rem / 20px | 500 | 0.00625rem | plain |
| `body-large` | 1rem / 16px | 1.5rem / 24px | 400 | 0.03125rem | plain |
| `body-medium` | 0.875rem / 14px | 1.25rem / 20px | 400 | 0.015625rem | plain |
| `body-small` | 0.75rem / 12px | 1rem / 16px | 400 | 0.025rem | plain |
| `label-large` | 0.875rem / 14px | 1.25rem / 20px | 500 | 0.00625rem | plain |
| `label-medium` | 0.75rem / 12px | 1rem / 16px | 500 | 0.03125rem | plain |
| `label-small` | 0.6875rem / 11px | 1rem / 16px | 500 | 0.03125rem | plain |

Reference weights: `regular` 400, `medium` 500, `bold` 700.

What each family is *for*:

| Family | Job |
| --- | --- |
| **Display** | Marketing and hero moments. **A wiki has none.** |
| **Headline** | High-emphasis short text — a page title, a dialog headline. |
| **Title** | Medium-emphasis text that organises a region — section headings, app bar titles, card titles. |
| **Body** | Running prose. The wiki's whole reason for existing. |
| **Label** | UI chrome — button labels, tabs, chips, badges, captions. |

### 2.2 M3 Expressive — the Emphasized variants

M3 Expressive (2025) doubles the scale: every role gains an `-emphasized` companion at the **same size and line height**, one weight step heavier and with adjusted tracking.

| Role | Regular weight | Emphasized weight |
| --- | --- | --- |
| `display-*`, `headline-*` | 400 | 500 |
| `title-large` | 400 | 500 |
| `title-medium`, `title-small` | 500 | 700 |
| `body-*` | 400 | 500 |
| `label-*` | 500 | 700 |

This matters here because it is the sanctioned M3 way to add hierarchy **without adding a size step** — which is exactly what a dense documentation product needs. `body-large-emphasized` (16px/24px/500, tracking 0.15px) is the correct treatment for an inline lead-in or a definition term.

### 2.3 Which roles a wiki actually uses

Discard `display-*` entirely. Then:

**Document body — the reading surface**

| Element | Role | Concrete value | Note |
| --- | --- | --- | --- |
| `h1` (page title) | `headline-medium` | 28px / 36px / 400 | |
| `h2` | `headline-small` | 24px / 32px / 400 | |
| `h3` | `title-large` | 22px / 28px / 400 | |
| `h4` | `title-medium` | 16px / 24px / 500 | |
| `h5` | `title-small` | 14px / 20px / 500 | |
| `h6` | `label-large` | 14px / 20px / 500 | Use letter-spacing, not size, to distinguish from `h5` |
| paragraph | `body-large`, relaxed leading | 16px / **26px** / 400 | See the deviation note below |
| blockquote | `body-large` | 16px / 26px / 400 | Distinguished by `outline-variant` left rule and `text-muted` |
| inline code | `body-medium`, mono | 14px / 24px | Size-matched to surrounding 16px prose optically |
| code block | `body-medium`, mono | 14px / 20px | On `bg-emphasized` |
| table cell | `body-medium` | 14px / 20px | |
| figure caption | `body-small` | 12px / 16px | `text-muted` |

Heading sizes step 28 → 24 → 22 → 16 → 14. `h1`–`h3` are cleanly separated by size alone, satisfying checklist §4.4's "distinguishable by more than weight". `h4`–`h6` sit at body size and separate by weight, tracking and colour; a deep-wiki page that needs a visually distinct `h5` is over-nested, and that is a content problem, not a typography problem.

**Documented deviation from M3.** M3 specifies `body-large` at 16px/24px (1.5). This project uses **16px/26px (1.625)** for the document body only. Reason: M3's body metrics are tuned for short mobile-length passages; checklist §4.4 requires generous vertical rhythm for long-form reading, and this is a tool people read in all day. Size, weight and tracking are unchanged. Chrome text keeps M3's 24px leading.

**Chrome — verified from the M3 component tokens**

| Surface | Role |
| --- | --- |
| Top app bar (small) headline | `title-large` |
| Top app bar (medium) headline | `headline-small` |
| Button label | `label-large` |
| Navigation drawer item label | `label-large` |
| Navigation drawer section headline | `title-small` |
| Navigation rail item label | `label-medium` |
| List item label | `body-large` |
| List item supporting text | `body-medium` |
| List item overline / trailing meta | `label-small` |
| Tab label | `title-small` |
| Dialog headline | `headline-small` |
| Dialog supporting text | `body-medium` |
| Snackbar supporting text | `body-medium` |
| Snackbar action label | `label-large` |
| Chip label | `label-large` |
| Badge label | `label-small` |
| Plain tooltip text | `body-small` |
| Text field input | `body-large` |
| Text field supporting/helper text | `body-small` |

### 2.4 Reconciling with the 65–80 character measure

Checklist §4.4 requires the document column to hold roughly 65–80 characters per line. M3 has no measure rule — it is a mobile-first system where the viewport is the measure.

The correct expression is a `ch`-relative container token, because `ch` is defined against the element's own font and therefore self-corrects when the theme changes the body size or the user zooms.

```css
@theme {
  --container-measure: 72ch;   /* → max-w-measure */
}
```

72ch lands inside the 65–80 band for every reasonable body face. Apply `max-w-measure` to the prose column, never to the pane. Tables, code blocks and diagrams are explicitly exempt: they get the full pane width and scroll inside their own container (checklist §6).

Do **not** use `--ui-container` (80rem / 1280px) for prose. That token is the app shell's max width, not the reading measure.

#### A measure is a cap, not a position — and the column is the shell's

Added 2026-09-07, because the paragraph above produced exactly the screen it exists to prevent, and this section is where an implementer reads it.

`max-w-measure` sets a maximum width and nothing else. The element still begins wherever its parent's content box begins, so applied on its own it yields a 659px column pinned to the left gutter with the rest of the viewport empty beside it. Measured at 1280×900 in both themes on 2026-09-07: the read, edit and navigation-tree columns each rendered **658.9px wide at x=32**, leaving 589px of unused page — half a wide screen, on every product screen at once. §8.3's "Don't" list already said "`max-w-measure` (§2.4), then centre"; nobody who implemented the measure ever read as far as §8.

**Ruling: `max-w-measure` is never written alone. It is `mx-auto w-full max-w-measure`.**

**Ruling: the column is the app shell's, not the screen's.** Width and horizontal position belong beside the height, for the reason checklist §4.1 gives about anything that appears on more than one screen: a value spelled out on five screens is five chances to drift, and these five had already drifted — the auth screens centred at `max-w-md`, the three product screens capped and not centred, the smoke page capped for its heading and uncapped for the grid below it, and each with its own `UContainer` and its own vertical rhythm. A screen **names which column it stands in**; the shell owns what that means.

| Column | Width | What stands in it |
| --- | --- | --- |
| `measure` | `--container-measure` (72ch) | Prose and anything sharing a screen with it: read mode, edit mode, the notices a screen shows instead of its content, the error screen. |
| `narrow` | `max-w-md` (28rem) | One card holding a short form — the four auth screens. |
| `wide` | `--ui-container` (80rem) | A screen whose content is a grid of panels rather than a document. |

Two consequences worth stating, because both were decided by measurement rather than by taste:

- **Edit mode takes the same column as read mode, and that is not a coincidence to be re-derived per screen.** Two screens that each state their own width are two chances for the text to move under the cursor when the user switches modes.
- **The navigation tree takes the measure too.** A tree row is not prose, but it is a single line of `body-large` read left to right, and a label that starts at x=0 and ends at x=1216 is the scanning problem the 65–80 character band exists to solve — with the added cost that the eye must travel back across empty space to the next row's indent. The exemptions above are for content that *exceeds* the measure and scrolls inside its own box (tables, code, diagrams); a tree under-fills it, which is a different case.

A screen on the `wide` column still gets its prose measured: `PageHeading` caps its own block at `max-w-measure`, because a heading's supporting sentence is prose wherever it stands, and 1216px of it is about 150 characters to the line.

### 2.5 In this stack

Register the type scale as Tailwind v4 `--text-*` tokens. The `--text-<name>--line-height`, `--text-<name>--letter-spacing` and `--text-<name>--font-weight` modifiers let one utility class carry all four properties, which is what makes `text-title-large` a real replacement for four hand-written classes.

```css
/* main.css, after the imports */
@theme static {
  /* ---- Headline ---- */
  --text-headline-large: 2rem;
  --text-headline-large--line-height: 2.5rem;
  --text-headline-large--letter-spacing: 0rem;
  --text-headline-large--font-weight: 400;

  --text-headline-medium: 1.75rem;
  --text-headline-medium--line-height: 2.25rem;
  --text-headline-medium--letter-spacing: 0rem;
  --text-headline-medium--font-weight: 400;

  --text-headline-small: 1.5rem;
  --text-headline-small--line-height: 2rem;
  --text-headline-small--letter-spacing: 0rem;
  --text-headline-small--font-weight: 400;

  /* ---- Title ---- */
  --text-title-large: 1.375rem;
  --text-title-large--line-height: 1.75rem;
  --text-title-large--letter-spacing: 0rem;
  --text-title-large--font-weight: 400;

  --text-title-medium: 1rem;
  --text-title-medium--line-height: 1.5rem;
  --text-title-medium--letter-spacing: 0.009375rem;
  --text-title-medium--font-weight: 500;

  --text-title-small: 0.875rem;
  --text-title-small--line-height: 1.25rem;
  --text-title-small--letter-spacing: 0.00625rem;
  --text-title-small--font-weight: 500;

  /* ---- Body ---- */
  --text-body-large: 1rem;
  --text-body-large--line-height: 1.5rem;
  --text-body-large--letter-spacing: 0.03125rem;
  --text-body-large--font-weight: 400;

  --text-body-medium: 0.875rem;
  --text-body-medium--line-height: 1.25rem;
  --text-body-medium--letter-spacing: 0.015625rem;
  --text-body-medium--font-weight: 400;

  --text-body-small: 0.75rem;
  --text-body-small--line-height: 1rem;
  --text-body-small--letter-spacing: 0.025rem;
  --text-body-small--font-weight: 400;

  /* ---- Label ---- */
  --text-label-large: 0.875rem;
  --text-label-large--line-height: 1.25rem;
  --text-label-large--letter-spacing: 0.00625rem;
  --text-label-large--font-weight: 500;

  --text-label-medium: 0.75rem;
  --text-label-medium--line-height: 1rem;
  --text-label-medium--letter-spacing: 0.03125rem;
  --text-label-medium--font-weight: 500;

  --text-label-small: 0.6875rem;
  --text-label-small--line-height: 1rem;
  --text-label-small--letter-spacing: 0.03125rem;
  --text-label-small--font-weight: 500;

  /* ---- Document body: the one deviation (§2.3) ---- */
  --text-doc-body: 1rem;
  --text-doc-body--line-height: 1.625rem;
  --text-doc-body--letter-spacing: 0.03125rem;
  --text-doc-body--font-weight: 400;

  /* ---- Measure (§2.4) ---- */
  --container-measure: 72ch;
}
```

Usage: `class="text-title-large text-highlighted"`, `class="text-doc-body text-default max-w-measure"`.

For the Expressive emphasized variants, add the ones actually needed rather than all fifteen — `--text-body-large-emphasized` (weight 500) and `--text-label-large-emphasized` (weight 700) cover the real cases.

Nuxt UI's own components keep using `text-xs` / `text-sm` / `text-base` internally; that is fine and must not be "corrected". The `--text-*` tokens above are for project-authored markup.

**Do**
- Use one type role per element, via one utility class.
- Use `text-doc-body` for prose and the M3 roles for everything else.
- Reach for an Emphasized weight before reaching for a new size.

**Don't**
- Don't use `display-*`. This product has no hero.
- Don't set `font-size` and `line-height` separately in markup — that is exactly the "no arbitrary values fighting the scale" failure in checklist §4.1.
- Don't let `h2` and `h3` land on the same size.

---

## 3. Shape

### 3.1 The M3 rule — the corner radius scale

| Token | Value | Typical components |
| --- | --- | --- |
| `corner-none` | 0px | Full-bleed surfaces: top app bar, navigation rail, banners |
| `corner-extra-small` | 4px | Menus, plain tooltips, snackbars, text field container |
| `corner-small` | 8px | Chips |
| `corner-medium` | 12px | Cards, rich tooltips, "square" small buttons |
| `corner-large` | 16px | Navigation drawer trailing edge, side sheets |
| `corner-large-increased` | 20px | *(M3 Expressive)* |
| `corner-extra-large` | 28px | Dialogs, FABs, large "square" buttons |
| `corner-extra-large-increased` | 32px | *(M3 Expressive)* |
| `corner-extra-extra-large` | 48px | *(M3 Expressive)* Large expressive containers |
| `corner-full` | 9999px | Buttons, search bars, chips in selected state, active indicators, focus rings |

Directional variants exist and are used, not decorative: `corner-large-top` (16 16 0 0) for bottom sheets, `corner-large-end` (0 16 16 0) for the navigation drawer, `corner-extra-small-top` for filled text fields.

That table is M3's specification, and it stays as M3's specification. Where this project departs from a row of it, the departure is stated in §3.4 and recorded in §14 — never by rewriting the row.

### 3.2 What M3 Expressive changed

Expressive expanded shape from a fixed property into an **expressive axis**:

- Three new radius steps were added (20, 32, 48) to give designers room between the old steps.
- `corner-full` changed meaning: it is now literally full (`9999px`), not "50% of the component".
- **Shape morphing** became a first-class interaction. Buttons carry both a round and a square shape token *and* a distinct pressed shape. From the Compose tokens:

| Button size | Height | Round shape | Square shape | **Pressed shape** |
| --- | --- | --- | --- | --- |
| Extra small | 32dp | full | 12px | **8px** |
| Small | 40dp | full | 12px | **8px** |
| Medium | 56dp | full | 16px | **12px** |
| Large | 96dp | full | 28px | **16px** |
| Extra large | 136dp | full | 28px | **16px** |

The pressed corner is *smaller* than the rest corner. Pressing squares the button slightly. This is Expressive's principal press affordance, and it is why an M3 Expressive button feels physical while a flat Tailwind button does not.

Note that Expressive's square shapes scale **with the component's height**: 32dp and 40dp controls take 12px, a 56dp control takes 16px, 96dp takes 28px. Corner size is proportional to the object, not fixed per component class. This is the one Expressive idea that bears directly on §9.5, because M3's text field is a 56dp control.

#### What Expressive did *not* change: text fields

Verified 2026-09-06, because §9.5 was rejected on review on exactly this point.

| Source | State on `androidx-main`, today |
| --- | --- |
| `OutlinedTextFieldTokens.kt` | `// VERSION: v0_103` · `ContainerShape = ShapeKeyTokens.CornerExtraSmall` · `ContainerHeight = 56.0.dp` |
| `FilledTextFieldTokens.kt` | `// VERSION: v0_210` · `ContainerShape = ShapeKeyTokens.CornerExtraSmallTop` · `ContainerColor = ColorSchemeKeyTokens.SurfaceContainerHighest` |
| `Shapes.kt` KDoc on `extraSmall` | "By default autocomplete menu, select menu, snackbars, standard menu, **and text fields** use this shape." |
| `tokens/` directory listing | Only `FilledTextFieldTokens.kt` and `OutlinedTextFieldTokens.kt` exist. There is no Expressive text-field token file. |

Two of those are decisive. `FilledTextFieldTokens.kt` sits at token version **v0_210** — regenerated well after the v0.192 baseline this document was written against — and still emits `CornerExtraSmallTop`. And `Shapes.kt` is the very file that *carries* the Expressive additions (`largeIncreased`, `extraLargeIncreased`, `extraExtraLarge`), yet its `extraSmall` KDoc still names text fields.

**Conclusion: M3 Expressive did not move text fields off `corner-extra-small`.** The shape scale grew at the top end (20 / 32 / 48) and `corner-full` was redefined; the bottom end, where text fields live, was untouched. Any claim that "current M3 says text fields are rounder" is false at the token level. If this project rounds its fields, it does so as a recorded deviation and for its own reasons — see §3.4 and §9.5.

### 3.3 In this stack

Nuxt UI derives its whole radius ladder from one variable:

| Utility | Formula |
| --- | --- |
| `rounded-xs` | `calc(var(--ui-radius) * 0.5)` |
| `rounded-sm` | `var(--ui-radius)` |
| `rounded-md` | `calc(var(--ui-radius) * 1.5)` |
| `rounded-lg` | `calc(var(--ui-radius) * 2)` |
| `rounded-xl` | `calc(var(--ui-radius) * 3)` |
| `rounded-2xl` | `calc(var(--ui-radius) * 4)` |
| `rounded-3xl` | `calc(var(--ui-radius) * 6)` |

**Ruling: set `--ui-radius: 0.5rem`.** That one change lands the entire Nuxt UI ladder on the M3 shape scale:

| Utility | With `--ui-radius: 0.5rem` | M3 token |
| --- | --- | --- |
| `rounded-none` | 0px | `corner-none` |
| `rounded-xs` | 4px | `corner-extra-small` |
| `rounded-sm` | 8px | `corner-small` |
| `rounded-md` | 12px | `corner-medium` |
| `rounded-lg` | 16px | `corner-large` |
| `rounded-xl` | 24px | *(between `large-increased` 20 and `extra-large` 28 — the one miss)* |
| `rounded-2xl` | 32px | `corner-extra-large-increased` |
| `rounded-3xl` | 48px | `corner-extra-extra-large` |
| `rounded-full` | 9999px | `corner-full` |

```css
:root, :host { --ui-radius: 0.5rem; }
```

Nuxt UI's stock defaults then land correctly without further work: `UButton` and `UDropdownMenu` use `rounded-md` (12px = `corner-medium`, which is exactly M3 Expressive's *square* small-button shape), `UCard` uses `rounded-lg` (16px = `corner-large`), `UTooltip` uses `rounded-sm` (8px).

**Ruling on button shape.** M3's default button shape is `corner-full`. This project uses **`corner-medium` (12px)** — the M3 Expressive *square* variant — because a dense, keyboard-driven professional tool reads better with rectilinear controls, and because pill-shaped buttons at 32px height waste horizontal space in toolbars. This is an M3-sanctioned shape, not an invention.

**Shape morph on press.** Express Expressive's pressed shape with a single active variant, applied through `app.config.ts` so it lands on every button at once:

```ts
export default defineAppConfig({
  ui: {
    button: {
      slots: {
        base: 'transition-[border-radius,background-color] active:rounded-sm'
      }
    }
  }
})
```

`rounded-md` → `active:rounded-sm` is 12px → 8px, matching the M3 small-button pressed token exactly.

Only these radii exist. `rounded-[10px]` is a checklist §4.1 failure.

**Do**
- Set `--ui-radius` once, in `main.css`. Never per component.
- Use `rounded-none` for full-bleed chrome (top app bar, pane edges) — a rounded corner on an edge-to-edge region is wrong in M3 and always looks like a mistake.
- Use `rounded-full` for the things M3 says are full: focus rings, active indicators, avatars, badges, count chips.

**Don't**
- Don't mix radii within one component. A card with `rounded-lg` does not contain a `rounded-xl` image.
- Don't use `rounded-xl` (24px) for anything that has a real M3 token; it is the one rung with no exact M3 equivalent.

### 3.4 Shape coherence — how much does M3 actually ask for?

Less than one might hope, and in the opposite direction to the intuition.

M3's own statement of what shape is for, quoted verbatim from the file-level KDoc of `androidx.compose.material3.Shapes` (which reproduces the shape overview page, the page `m3.material.io` renders only in JavaScript):

> "Material surfaces can be displayed in different shapes. Shapes direct attention, **identify components**, communicate state, and express brand."

*Identify components.* Shape in M3 is a **differentiating** signal, not a uniforming one. The scale deliberately assigns different rungs to different classes of object — 4px fields and menus, 8px chips, 12px cards, 16px drawers, 28px dialogs, `corner-full` buttons — and a screen carrying three different radii is M3 working as specified, not M3 being violated. There is no M3 rule that says "pick one radius for your product".

What Expressive adds is permission, not prescription: shape became an adjustable axis, so a product may choose a softer or sharper direction than the defaults, and shape and radius may be combined "to generate visual tension or cohesion". That is the licence under which this document deviates. It is not an instruction that everything must match.

**Ruling: this product commits to a two-rung shape direction, and every deviation below is an application of it.**

| Class of object | Rung | Utility | Members |
| --- | --- | --- | --- |
| **Controls** — things you operate | `corner-medium` 12px | `rounded-md` | Buttons, text fields and the whole text-field family, dropdown triggers, menus |

The **menus** row binds to project-authored menus as much as to `UDropdownMenu`. The editor's `@` mention and `/` slash surfaces were built as `rounded-lg` and were the only 16px menus in the app — a container radius on a control, and one rung away from every menu the library renders beside them (measured 2026-09-07, corrected the same day).
| **Containers** — things that hold controls | `corner-large` 16px | `rounded-lg` | Cards, panels, the auth card |

Full-bleed chrome stays `rounded-none`; the closed `rounded-full` set from §3.3 (focus rings, avatars, badges, active indicators) is unaffected; dialogs keep `corner-extra-large`. The two rungs are **adjacent on the M3 scale and correctly ordered** — a control is never rounder than the container it sits in — so M3's "shape identifies components" survives at the level that matters on a real screen, while the screen still reads as one system rather than three.

The rung a deviation moves *to* must be a real M3 token. `corner-medium` and `corner-large` are. `rounded-[10px]` is still a §12.3 failure.

---

## 4. Elevation

### 4.1 The M3 rule — levels 0 to 5

| Level | dp | Where it is used |
| --- | --- | --- |
| 0 | 0 | Default. Cards at rest, filled/text/outlined buttons, top app bar at rest, navigation rail |
| 1 | 1 | Elevated card, elevated button, search bar at rest |
| 2 | 3 | Menu, rich tooltip, dropdown, autocomplete |
| 3 | 6 | Dialog, modal bottom sheet, snackbar, search view, active search bar |
| 4 | 8 | Navigation drawer (modal) |
| 5 | 12 | Highest — rarely correct |

### 4.2 The important part — tone, not shadow

M3 **removed** the elevation-driven surface tint overlay and the opacity-overlay model entirely. The `surface-tint` role and `ElevationOverlay` remain in older APIs as deprecated compatibility. The replacement is §1.3's container ladder.

The consequence is precise:

> **An elevation level tells you which `surface-container-*` tone to use. It does not tell you to draw a shadow.**

Practical mapping:

| Level | Container tone to use | Shadow? |
| --- | --- | --- |
| 0 | `surface` / `surface-container-lowest` | No |
| 1 | `surface-container-low` | Only if it floats |
| 2 | `surface-container` | Yes — it floats |
| 3 | `surface-container-high` | Yes — it floats |
| 4–5 | `surface-container-highest` | Yes — it floats |

### 4.3 When a shadow is still correct

A shadow is correct for, and only for, a surface that:

1. **floats above the page rather than being part of it**, and
2. **can be dismissed** — it is transient.

That set is closed: menus, dropdowns, popovers, tooltips, dialogs, modals, drawers/slideovers when modal, toasts, and drag previews. Everything persistent — the navigation tree, the contextual panel, the top app bar, cards, list rows, the document canvas — is a *region*, gets a container tone, and gets **no shadow**.

M3's own shadow definitions, for reference when retuning tokens (key shadow at 30% opacity, ambient at 15%):

| Level | Key shadow | Ambient shadow |
| --- | --- | --- |
| 1 | `0 1px 2px 0` | `0 1px 3px 1px` |
| 2 | `0 1px 2px 0` | `0 2px 6px 2px` |
| 3 | `0 1px 3px 0` | `0 4px 8px 3px` |
| 4 | `0 2px 3px 0` | `0 6px 10px 4px` |
| 5 | `0 4px 4px 0` | `0 8px 12px 6px` |

### 4.4 In this stack

Nuxt UI already applies shadows to almost exactly the correct set. Verified from the resolved theme: `shadow-lg` appears on `modal`, `slideover`, `popover`, `dropdownMenu`, `contextMenu`, `select`, `selectMenu`, `inputMenu`, `navigationMenu`, `toast`, `sidebar`, and the editor menus; `shadow-sm` on `tooltip`. Nothing else carries a shadow.

**Ruling: accept Nuxt UI's shadow placement unchanged.** It is M3-correct. If the shadow *rendering* needs to match M3, retune the tokens once, centrally, rather than adding classes:

```css
@theme {
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.30), 0 1px 3px 1px rgb(0 0 0 / 0.15);  /* M3 level 1 */
  --shadow-md: 0 1px 2px 0 rgb(0 0 0 / 0.30), 0 2px 6px 2px rgb(0 0 0 / 0.15);  /* M3 level 2 */
  --shadow-lg: 0 1px 3px 0 rgb(0 0 0 / 0.30), 0 4px 8px 3px rgb(0 0 0 / 0.15);  /* M3 level 3 */
}
```

Because every floating surface uses `shadow-lg`, that single override moves the whole overlay set at once.

**Do**
- Reach for a container tone first. `bg-elevated` and `bg-accented` are the tools for hierarchy.
- Let Nuxt UI's overlay components bring their own shadow. Do not add one.
- Give the navigation tree and contextual panel `bg-elevated` and a `border-default` divider — no shadow, no tint.

**Don't**
- Don't put `shadow-*` on a card, a list row, a panel, a sticky header, or the app bar.
- Don't reintroduce `surface-tint`. It is deprecated.
- Don't rely on a shadow to separate two regions. It vanishes in dark themes and fails checklist §4.2.

### 4.5 Stacking order — which overlay wins

Added 2026-09-17. §4.1's levels say which *tone* and *shadow* a floating surface takes; they say nothing about which of two floating surfaces is on top, and M3's own answer (the modal drawer at level 4 above the dialog at level 3) is the wrong one for this product. Measured at 320×900: a person edits a page, opens the drawer, clicks a row; "Leave without saving?" opens — and the drawer stands *above* it. Both are Reka dialogs portalled into the body at `z-index: auto`, so the one that opened later won, the scrim never covered the drawer, and only Escape could answer the question. The owner's ruling: **the confirm dialog outranks every overlay.** A question the product asks is asked from wherever the person is, and it is the topmost thing on the screen until it is answered.

The ladder, from the page up. Every rung is a Tailwind `z-<n>` utility on the numeric scale, stated once — in `app.config.ts` for a library component, on the one component for a project-authored surface — never per screen:

| Rung | `z` | Members | Stated where |
| --- | --- | --- | --- |
| The page | — | Panes, cards, rows, the document | — |
| Floating controls inside a pane | `z-10` | The editor's `@` and `/` menus, the selection toolbar, the block handle's chip, the comment gutter's floating action | on each component |
| Chrome that stays put | `z-50` | The sticky app bar (`UHeader`, the library's own), the skip link while focused | the library; `WorkspaceFrame` |
| Transient overlays | `auto` | Dropdown and context menus, popovers, tooltips, and the 320 drawer (`USlideover` inside the sidebar) — the library's own, in the order they opened | the library |
| Modals | `z-60` | Every `UModal`: the tree's New… and Rename…, the invite dialog. Scrim **and** content, or the scrim would not cover the drawer | `app.config.ts`, `modal` |
| The confirm dialog | `z-70` | `ConfirmDialog` — `useConfirm()`'s one dialog. Scrim and content | `ConfirmDialog.vue` |
| Toasts | `z-[100]` | `UToast` — the library's own; a "saved" must be seen over a dialog | the library |

Focus is not stacking and needs no rung: Reka keeps a stack of focus scopes and the last dialog opened holds the trap, so focus lands in the confirm dialog while the drawer waits behind it, and returns to the row that asked when the dialog closes (checklist §5). What the ladder fixes is the pointer: with the dialog on the top rung, `elementFromPoint` at Cancel is Cancel.

**Do**
- Open a question through `useConfirm()`; it is already on the top rung.
- Put a new modal on `UModal` and let `app.config.ts` place it.

**Don't**
- Don't write a `z-*` on a screen. A rung belongs to a kind of surface, not to a screen's fight with another.
- Don't reach for `z-[9999]`. The ladder has seven rungs and the toaster is the top of it.

---

## 5. State layers

This is the most-missed part of M3 and the reason AI-generated UI feels dead. A screenshot cannot show it, so it never gets built.

### 5.1 The M3 rule

Every interactive element carries a **state layer**: a translucent overlay of the element's *content colour*, painted over its container, at a fixed opacity per state.

| State | Opacity |
| --- | --- |
| Hover | **0.08** |
| Focus | **0.12** |
| Pressed | **0.12** |
| Dragged | **0.16** |

Four properties of the model matter:

1. **The layer's colour is the `on-` role, not the container role.** A ghost button with `text-primary` gets a `primary` layer. A list row with `text-on-surface` gets an `on-surface` layer. This is why the layer always reads as "the same control, more active" instead of "a different colour".
2. **It composites, it does not replace.** The container tone stays; the layer sits on top.
3. **Focus and pressed share 0.12**, so focus and press are not distinguished by the layer alone — focus adds the focus indicator, press adds (in Expressive) the shape morph.
4. **Every interactive element has one.** Rows, tree nodes, icon buttons, tabs, chips, menu items, list items. Not just buttons.

M3's focus indicator is separate from the state layer: a **3px** ring, **2px** outward offset, `corner-full`, in the `secondary` role, growing to 8px on the active frame of its animation.

### 5.2 In this stack

Nuxt UI implements state layers by **stepping the background colour**, not by compositing a separate layer. Two different mechanisms depending on the colour family. Verified from the resolved `UButton` theme:

**Chromatic aliases — opacity modifiers on the alias value**

| Variant | Rest | Hover | Active |
| --- | --- | --- | --- |
| `solid` | `bg-primary` | `bg-primary/75` | `bg-primary/75` |
| `outline` | transparent + `ring-primary/50` | `bg-primary/10` | `bg-primary/10` |
| `soft` | `bg-primary/10` | `bg-primary/15` | `bg-primary/15` |
| `subtle` | `bg-primary/10` + `ring-primary/25` | `bg-primary/15` | `bg-primary/15` |
| `ghost` | transparent | `bg-primary/10` | `bg-primary/10` |
| `link` | `text-primary` | `text-primary/75` | `text-primary/75` |

**Neutral — discrete steps up the `--ui-bg-*` ladder**

| Variant | Rest | Hover / Active |
| --- | --- | --- |
| `solid` | `bg-inverted` | `bg-inverted/90` |
| `outline` | `bg-default` | `bg-elevated` |
| `soft` / `subtle` | `bg-elevated` | `bg-accented/75` |
| `ghost` | transparent | `bg-elevated` |

Focus is uniform and separate: `focus-visible:outline-3` with `outline-<color>/25`, plus `focus-visible:ring-<color>` on ring-bearing variants. **Nuxt UI's 3px focus outline is the same width as M3's focus ring** — no change needed.

`UTree` and `UNavigationMenu` already use a true M3-style compositing layer: an absolutely-positioned `before:` pseudo-element behind the content (`before:absolute before:inset-0 before:z-[-1] before:rounded-md`) filled with `before:bg-elevated` on hover and `before:bg-elevated/50` for the resting selected state.

#### The two genuine conflicts, and the rulings

**Conflict 1 — there is no pressed state.** Nuxt UI sets `hover:` and `active:` to the *same* value on every chromatic variant. Pressing a button produces no feedback at all. M3 requires a distinct pressed step.

*Ruling: keep Nuxt UI's variant system; add the missing pressed step centrally.* M3's opacities map exactly onto Tailwind's opacity modifiers — `/8`, `/12`, `/16` are literally 0.08, 0.12, 0.16 — so the translation is direct and requires no arbitrary values.

```ts
// apps/web/app/app.config.ts
export default defineAppConfig({
  ui: {
    button: {
      slots: {
        // M3 Expressive shape morph on press (§3.3)
        base: 'transition-[border-radius,background-color] active:rounded-sm'
      },
      compoundVariants: [
        // ghost / outline: 0 → 0.08 hover → 0.12 pressed
        { variant: 'ghost',   color: 'primary', class: 'hover:bg-primary/8 active:bg-primary/12' },
        { variant: 'outline', color: 'primary', class: 'hover:bg-primary/8 active:bg-primary/12' },
        // soft / subtle: container + 0.08 hover → +0.12 pressed
        { variant: 'soft',    color: 'primary', class: 'hover:bg-primary/18 active:bg-primary/22' },
        { variant: 'subtle',  color: 'primary', class: 'hover:bg-primary/18 active:bg-primary/22' }
      ]
    }
  }
})
```

**Conflict 2 — `solid` uses alpha, which is backwards in dark themes.** `hover:bg-primary/75` makes the button *translucent*, letting the page show through. In light mode that lightens it, which coincidentally resembles M3. In dark mode over a dark ground it *darkens* the button on hover — the opposite of M3, where a white-ish state layer always lightens. It also violates checklist §4.2's principle that nothing may depend on the background being light or dark.

*Ruling (superseded 2026-09-03 — see §14): apply the state layer as a compositing `before:` overlay of `currentColor`, not by stepping the shade.* Stepping the shade was the original ruling and it fails: one Nuxt UI shade slot spans ten M3 tones, roughly two and a half times what an 0.12 state layer is worth, so `hover:bg-primary-500` overshoots and drops the white label to **3.15:1** — below the checklist's pass/fail 4.5:1 floor, which wins on conflict per §0. A `currentColor` overlay reproduces M3's intent exactly, because its colour *is* the `on-` role: it lightens in light mode and darkens in dark mode by construction, and it never touches the label's contrast.

```ts
compoundVariants: [
  {
    variant: 'solid', color: 'primary',
    class: [
      'bg-primary text-inverted',
      // light: tone 40 → 50 → 60
      'hover:bg-primary-500 active:bg-primary-400',
      // dark: tone 80 → 90 → 95
      'dark:hover:bg-primary-100 dark:active:bg-primary-50'
    ].join(' ')
  }
]
```

#### For project-authored interactive surfaces

If a surface has no Nuxt UI component — check first; `UTree`, `UNavigationMenu`, `UDropdownMenu` and `UButton` cover almost everything — define the compositing layer **once**, in `main.css`, using the same `before:` idiom Nuxt UI itself uses:

```css
@utility dw-state-layer {
  position: relative;
  isolation: isolate;
}
@utility dw-state-layer {
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background-color: currentColor;
    opacity: 0;
    transition: opacity 100ms var(--ease-standard);
  }
  &:hover::before  { opacity: 0.08; }
  &:focus-visible::before { opacity: 0.12; }
  &:active::before { opacity: 0.12; }
}
@media (prefers-reduced-motion: reduce) {
  .dw-state-layer::before { transition: none; }
}
```

`background-color: currentColor` is the M3 rule literally expressed: the layer is the content colour.

#### A state is a layer, never a step to another surface rung

Added 2026-09-07. Writing `hover:bg-elevated` on a project-authored row is the reflex answer to "make hover visible", and it fails twice over — both failures were measured on the same screens the day this was written:

- **It is a no-op wherever the element already sits on that rung.** A navigation tree row inside a `bg-elevated` container hovering to `bg-elevated` repaints the same tone over itself: oklch(0.94828) on oklch(0.94828) in light, oklch(0.28448) on oklch(0.28448) in dark. The class is present, the review sees a hover class, and nothing happens.
- **Its direction reverses between themes.** The ladder is symmetric about the page ground, so a fixed rung is *lighter* than `bg-accented` in light and *darker* in dark. A menu row hovering from `bg-accented` to `bg-elevated` measured 0.93103 → 0.94828 in light and 0.32759 → 0.28448 in dark: brighter on one theme, dimmer on the other, for the same interaction. That is checklist §4.2's "nothing depends on the background being light or dark".

The M3 state layer has neither problem, because its colour is `currentColor` — the `on-` role — so it always moves *away from* whatever it is drawn on, in the correct direction, on any rung. Use `dw-state-layer`. A container fill on an interactive element is correct for exactly one thing: a **selected** or **active** state, which is a semantic role (`secondary-container`), opaque, and identical in both themes.

**Do**
- Give **every** interactive element hover, focus-visible and pressed feedback. Tree rows, comment gutter icons, tab strips, presence avatars, the AI panel's stop control.
- Express hover, focus and pressed as a `currentColor` state layer; reserve container fills for selected/active.
- Use `/8`, `/12`, `/16` — they are M3's opacities exactly.
- Keep `focus-visible:outline-3`. It already matches M3's ring width.
- Add the pressed step and the shape morph via `app.config.ts` once, so every button gets it.

**Don't**
- Don't leave hover and active identical. That is the "dead UI" signature.
- Don't use `bg-<color>/75` on a solid fill. Step the shade instead.
- Don't hand-roll a state layer on a surface where a Nuxt UI component already provides one.
- Don't remove `:focus-visible` styling to "clean up" the hover look — automatic fail under checklist §5.

---

## 6. Motion

### 6.1 The M3 rule — easing

| Token | Curve | Use |
| --- | --- | --- |
| `easing-linear` | `cubic-bezier(0, 0, 1, 1)` | Progress indicators, continuous loops only |
| `easing-standard` | `cubic-bezier(0.2, 0, 0, 1)` | The default. Any transition that begins and ends on screen |
| `easing-standard-accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | Elements **leaving** the screen |
| `easing-standard-decelerate` | `cubic-bezier(0, 0, 0, 1)` | Elements **entering** the screen |
| `easing-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | Transitions the user should notice — a pane appearing, a mode change |
| `easing-emphasized-accelerate` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | Emphasised exits |
| `easing-emphasized-decelerate` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | Emphasised entrances |
| `easing-legacy` | `cubic-bezier(0.4, 0, 0.2, 1)` | M2 compatibility. Do not use in new work |

### 6.2 The M3 rule — duration

| Token | Value | | Token | Value |
| --- | --- | --- | --- | --- |
| `duration-short1` | 50ms | | `duration-long1` | 450ms |
| `duration-short2` | 100ms | | `duration-long2` | 500ms |
| `duration-short3` | 150ms | | `duration-long3` | 550ms |
| `duration-short4` | 200ms | | `duration-long4` | 600ms |
| `duration-medium1` | 250ms | | `duration-extra-long1` | 700ms |
| `duration-medium2` | 300ms | | `duration-extra-long2` | 800ms |
| `duration-medium3` | 350ms | | `duration-extra-long3` | 900ms |
| `duration-medium4` | 400ms | | `duration-extra-long4` | 1000ms |

### 6.3 Which transition gets which

| Transition | Duration | Easing |
| --- | --- | --- |
| State layer / colour change on hover, focus, press | `short2` 100ms | `standard` |
| Icon or small control state change | `short3` 150ms | `standard` |
| Menu, tooltip, popover **enter** | `short4` 200ms | `standard-decelerate` |
| Menu, tooltip, popover **exit** | `short2`–`short3` 100–150ms | `standard-accelerate` |
| Dialog / modal **enter** | `medium2` 300ms | `emphasized-decelerate` |
| Dialog / modal **exit** | `short4` 200ms | `emphasized-accelerate` |
| Pane collapse/expand, drawer slide | `medium4` 400ms | `emphasized` |
| Skeleton shimmer loop | `extra-long*` | `linear` |
| Expand/collapse of a tree branch | `short4` 200ms | `standard` |

Exits are always **shorter** than entrances. A user who dismisses something wants it gone.

### 6.4 M3 Expressive — spring motion

Expressive replaced duration+easing with **springs** for spatial motion, split into two families:

- **Spatial** — anything that moves, resizes, rotates, or changes shape. Damping below 1, so it overshoots and settles.
- **Effects** — colour and opacity. Damping exactly 1.0, so it never overshoots.

| Scheme | Token | Damping | Stiffness |
| --- | --- | --- | --- |
| Standard | default spatial | 0.9 | 700 |
| Standard | fast spatial | 0.9 | 1400 |
| Standard | slow spatial | 0.9 | 300 |
| Standard | default / fast / slow effects | 1.0 | 1600 / 3800 / 800 |
| Expressive | default spatial | 0.8 | 380 |
| Expressive | fast spatial | **0.6** | 800 |
| Expressive | slow spatial | 0.8 | 200 |
| Expressive | default / fast / slow effects | 1.0 | 1600 / 3800 / 800 |

**Ruling for deep-wiki: use the Standard scheme, not Expressive.** Expressive springs (damping 0.6–0.8) are designed for consumer hero moments. A tool people live in all day, whose content is a document, does not want its navigation tree bouncing. Checklist §4.4 already forbids decorative motion in the document body; the same reasoning applies to the chrome. Use M3's duration + easing tokens, which are what the Standard scheme approximates anyway.

Springs are also not natively expressible in CSS transitions. Do not pull in a physics library for this.

### 6.5 In this stack

Easing gets `--ease-*` theme tokens. Durations do **not** need tokens — M3's values are already Tailwind's numeric duration utilities.

```css
@theme {
  --ease-standard:               cubic-bezier(0.2, 0, 0, 1);
  --ease-standard-accelerate:    cubic-bezier(0.3, 0, 1, 1);
  --ease-standard-decelerate:    cubic-bezier(0, 0, 0, 1);
  --ease-emphasized:             cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized-accelerate:  cubic-bezier(0.3, 0, 0.8, 0.15);
  --ease-emphasized-decelerate:  cubic-bezier(0.05, 0.7, 0.1, 1);
}
```

| M3 duration | Tailwind utility |
| --- | --- |
| `short2` 100ms | `duration-100` |
| `short3` 150ms | `duration-150` |
| `short4` 200ms | `duration-200` |
| `medium2` 300ms | `duration-300` |
| `medium4` 400ms | `duration-400` |

Typical usage: `class="transition-colors duration-100 ease-standard"`.

Nuxt UI ships its own keyframes (`scale-in`, `scale-out`, `slide-in-from-*`, `fade-in/out`, `accordion-up/down`, and ~70 more) as raw `@keyframes`, **not** as `--animate-*` theme tokens, and applies them inline: `data-[state=open]:animate-[scale-in_100ms_var(--ease-out)]`. The durations it picks (100ms for popovers and menus, 200ms for modals) already match M3's `short2` / `short4`. Leave them alone.

Nuxt UI's colour transitions are globally gated:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  ui: { theme: { transitions: true } }   // default; emits `transition-colors` on components
})
```

### 6.6 `prefers-reduced-motion`

Checklist §5 makes this pass/fail: all non-essential transitions, streaming animations and skeleton shimmer must reduce or stop. Because Nuxt UI applies animations inline rather than through tokens, the only reliable point of control is a global override in `main.css`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

`1ms` rather than `0s` so that `transitionend` and `animationend` handlers still fire — zeroing them silently breaks any component that waits for one.

Two things must survive the reduction because they carry meaning, not decoration: the AI panel's **in-progress marking** (checklist §3 requires streaming output be visibly marked incomplete — use a static badge, not only a pulse) and the **focus indicator** (checklist §5).

**Do**
- Use `ease-standard` unless there is a reason not to.
- Make exits shorter than entrances.
- Verify the reduced-motion path with the OS setting actually on, not by reading the CSS.

**Don't**
- Don't animate the document body. Checklist §4.4.
- Don't animate `width`, `height`, `top` or `left`; use `transform` and `opacity`.
- Don't add motion that carries no information. A nav item that slides in for no reason is noise in a tool someone opens forty times a day.
- Don't adopt the Expressive spring scheme here.

---

## 7. Spacing and density

### 7.1 The M3 rule

M3 aligns everything — type baselines, component heights, padding, margins — to a **4dp grid**. Layout margins are 16dp on compact windows and 24dp from medium up; the gap between panes is 24dp.

M3's own component metrics are **touch-first**:

| Component | M3 size |
| --- | --- |
| Navigation rail width | 80dp |
| Navigation rail active indicator | 56 × 32dp |
| Navigation drawer width | 360dp |
| Navigation drawer active indicator | 336 × 56dp |
| Top app bar (small) height | 64dp |
| List item leading/trailing space | 16dp |
| List item leading icon | 24dp; avatar 40dp |
| Chip height | 32dp |
| Button height (M3 Expressive) | XS 32 / S 40 / M 56 / L 96 / XL 136dp |
| Search bar height | 56dp |

### 7.2 A wiki is denser than a consumer app

State this plainly, because it is the rule most likely to be got wrong by copying M3 examples:

> **M3's default density is wrong for this product.** M3's baseline is a phone held in one hand. deep-wiki is a three-pane desktop tool that a software team keeps open all day, with a navigation tree that may hold hundreds of pages. A 56dp list row and an 80dp navigation rail waste the vertical space the tree needs.

The correct adaptation is **not** to abandon the grid. It is to step down one density level while keeping every value a multiple of 4:

| Element | M3 default | deep-wiki | Rationale |
| --- | --- | --- | --- |
| Navigation tree row height | 56dp | **32px** (compact) / **40px** (default) | 40px still clears the 24×24 minimum target from checklist §5 with 8px of padding around a 24px icon |
| Navigation tree indent per level | 16dp | **12px** | Four levels (shelf → book → chapter → page) at 16px pushes titles off narrow viewports; checklist §6 |
| Navigation pane width | 360dp | **280px** default, resizable, persisted | Checklist §6 requires persisted resizable panes |
| Contextual panel width | — | **320px** default, resizable, persisted | |
| Top app bar height | 64dp | **56px** (`--ui-header-height: 3.5rem`) | Reclaims 8px of vertical space on every screen |
| Toolbar / secondary button height | 40dp | **32px** (`size="sm"`) | |
| Content-area button height | 40dp | **40px** (`size="md"`) | Unchanged |
| Primary action button height | 40dp | **40px** (`size="lg"`) | Unchanged; distinguished by variant, not size |

> **The three button rows above name heights the Nuxt UI sizes do not produce.** Measured against the installed `@nuxt/ui@4.11.0` theme, a `UButton` is `py-*` plus its size's line height: `xs` 24px, `sm` **28px**, `md` **32px**, `lg` **36px**, `xl` 40px. Only `xl` reaches M3's 40dp, and it does so by taking the label to 16px — one step above M3's `label-large`.
>
> This is §9.5's trap in a second component: a size variant is a calibrated bundle of padding *and* font size, so a height cannot be had by choosing a size; it has to be stated. `app.config.ts` therefore pins `sm → min-h-8`, `md → min-h-10`, `lg → min-h-10`, which makes the three rows above true of what renders. `min-h-*` rather than `h-*` because a button label can wrap and a fixed height would clip it (checklist §6).


| Pane gutter | 24dp | **16px** | |
| Document column padding | 24dp | **24px** (`p-6`) | Unchanged — reading comfort wins here |
| Paragraph spacing in document | — | **16px** (`space-y-4`) | Checklist §4.4 vertical rhythm |
| Block spacing (code, table, diagram) | — | **24px** (`space-y-6`) | |

Chrome is denser than content. That is the shape of checklist §4.4's "chrome is visually quieter than content" expressed as spacing.

### 7.3 In this stack

Tailwind v4's `--spacing` is `0.25rem` = 4px. **This is already the M3 4dp grid.** No configuration needed; `p-4` is 16dp, `gap-6` is 24dp.

The rule is therefore about *usage*, not tokens:

> Only integer multiples of the spacing scale in project-authored layout. `p-4`, `gap-6`, `space-y-4`, `px-3` are all on-grid. `p-1.5` (6px) and `py-2.5` (10px) are off-grid.

Nuxt UI's own components use half-steps internally (`px-2.5 py-1.5` on `UButton size="md"`). That is fine and must not be "corrected" — it is inside the library's own sizing system, which was calibrated as a whole. The rule binds project markup, not vendored components.

Sizes on Nuxt UI components:

| Nuxt UI `size` | Padding | Text | Use for |
| --- | --- | --- | --- |
| `xs` | `px-2 py-1` | `text-xs` | Dense inline chips and badges only |
| `sm` | `px-2.5 py-1.5` | `text-xs` | Toolbars, tree rows, panel headers, icon buttons in chrome |
| `md` | `px-2.5 py-1.5` | `text-sm` | Default; content-area actions, forms |
| `lg` | `px-3 py-2` | `text-sm` | The single primary action of a screen |
| `xl` | `px-3 py-2` | `text-base` | Rare — empty-state calls to action |

Set the density defaults once so no one repeats them:

```ts
// nuxt.config.ts — replaces the library default for every component whose default is `md`
export default defineNuxtConfig({
  ui: { theme: { defaultVariants: { size: 'md' } } }
})
```

```vue
<!-- Scope a denser default to a whole pane, rather than repeating size="sm" -->
<UTheme :props="{ button: { size: 'sm' }, tree: { size: 'sm' } }">
  <NavigationPane />
</UTheme>
```

`UTheme` is the right tool for pane-level density: it scopes props and `ui` overrides to a subtree through provide/inject, so the navigation pane can be dense without touching the document pane.

**Do**
- Keep every project-authored spacing value an integer multiple of 4px.
- Use `UTheme` to set pane-level density once, not `size="sm"` on forty call sites.
- Persist resizable pane widths per user (checklist §6).

**Don't**
- Don't copy M3's dp values literally into a desktop three-pane shell.
- Don't compress below 32px row height or below the 24×24 target minimum. Density that fails checklist §5 is not density, it is a defect.
- Don't mix `gap-4` in one list and `gap-5` in the next. Pick one per context and put it in the component.

### 7.4 Form and container rhythm

Added 2026-09-06 because §7.1–§7.3 could not answer the question a review asked of them. They gave the grid (4dp), the layout margins (16 / 24dp), the pane gap (24dp) and a table of *component sizes* — and then stopped. Nothing above says how far a label sits from the field it names, how much space separates two stacked fields, how much padding a card holding a form gets, or how far a page heading sits from the container below it. Every one of those had to be chosen by eye on `/login`, and the screen that resulted read as cramped. **A section that gives sizes but no rhythm is under-specified; this is the rhythm.**

Every value below is a real M3 number, not an interpolation. The sources are the component token files listed in §13; where M3 has no component for the case (a form, a page heading above a card), the M3 number for the nearest thing it *does* specify is used and the substitution is named.

#### Inside one field group

M3 has no external-label text field — its label lives in the outline notch — so the numbers come from `md-comp-outlined-field`, whose internal spaces are what the notched layout is built from.

| Distance | Value | M3 token | Why |
| --- | --- | --- | --- |
| Field container height | **56px** | `container-height` 56dp | `top-space` 16 + `body-large` line 24 + `bottom-space` 16 = 56. The 56dp field *is* the 16/24/16 rhythm; it is not an arbitrary height with text floated in it. |
| Field content inset, left and right | **16px** (`px-4`) | `leading-space` / `trailing-space` 16px | Nuxt UI's `xl` ships 12px. |
| Label → its field | **8px** (`mt-2`) | `label-text-padding-bottom` 8px | Nuxt UI's `UFormField` ships `mt-1` (4px), which is M3's *supporting-text* distance — the tightest space in the field spec, and the wrong one to put above a label. |
| Field → supporting / error text | **4px** (`mt-1`) | `supporting-text-top-space` 4px | Nuxt UI ships 8px. |

Note the asymmetry, and keep it: **8px above the field, 4px below it.** It is M3's, and it is what makes label + field + supporting text read as one object rather than three lines.

#### Between field groups, and around the form

M3 ships no form component. Its closest specified analogue is the **dialog** — a container whose whole job is to hold a short form — so the dialog's internal spacing is what these rows are taken from (`dialog/internal/_dialog.scss`: headline `padding: 24px 24px 0`; content `padding: 24px`, `padding-bottom: 8px` when actions follow; actions `padding: 16px 24px 24px`).

| Distance | Value | Source | Why |
| --- | --- | --- | --- |
| Stacked field group → field group | **24px** (`space-y-6`) | dialog headline → content = 24dp; M3 pane spacing 24dp | Nuxt UI's `UAuthForm` ships `space-y-5` (20px). On-grid, but the only 20px step on a screen whose every other step is 24, and too little to hold a field group that has grown: a validation message is 4px of supporting-text space plus a 20px line, so an invalid field consumed the whole gap. |
| Last field → submit action | **24px** | dialog content-bottom 8 + actions-top 16 = 24dp | Falls out of the row above; do not state it separately. |
| Card / container padding, compact | **16px** (`p-4`) | layout margin, compact window | Nuxt UI's `UCard` default. Correct as shipped. |
| Card / container padding, medium and up | **24px** (`sm:p-6`) | layout margin 24dp; dialog padding 24dp | Nuxt UI's `UCard` default. Correct as shipped. |
| Page heading block → the container below it | **32px** (`mt-8`) | 4dp grid, one step above the container's own 24px inset | M3 has no page-heading-above-a-card pattern. 32px is the next grid step past the card's internal 24, which is what keeps the heading reading as outside the card rather than as its title. |

#### The ordering trap, again

Three of these had to be written on a **size variant**, not on a slot, and getting that wrong silently produces the library's value:

| Property | Where it must go | What happens if written on the slot |
| --- | --- | --- |
| Field content inset | `input.variants.size.xl.base` | The size variant's `px-3` resolves after the slot and wins |
| Label → field | `formField.variants.orientation.vertical.container` | `orientation.vertical` sets `container: mt-1` and wins |
| Button height | `button.variants.size.*.base` | No slot expresses height per size at all |

This is the same failure §9.5 records for the 16px input text: **a size variant is a calibrated bundle, applied last.** A value that a variant also sets must be set on that variant.

**Do**
- Take a form's rhythm from this table, not from what looks balanced in a screenshot.
- Keep 8px above the field and 4px below it. Within-object tight, between-object generous.
- Put all of it in `app.config.ts` so the next form inherits it without a single spacing class in its markup.

**Don't**
- Don't state a height or an inset on a slot when a size variant also sets it.
- Don't let one component keep a 20px rhythm on a screen built on 24px. §12.6.
- Don't reach for a number between two grid steps because 24 felt tight and 32 felt loose. The answer is which object the space belongs to, not where the midpoint is.

---

## 8. Layout

### 8.1 The M3 rule — window size classes

| Class | Width range | Canonical layout |
| --- | --- | --- |
| **Compact** | 0–599dp | Single pane, bottom navigation or modal drawer |
| **Medium** | 600–839dp | Navigation rail + one pane |
| **Expanded** | 840–1199dp | Navigation rail + two panes |
| **Large** | 1200–1599dp | Navigation drawer + two or three panes |
| **Extra-large** | ≥1600dp | Navigation drawer + three panes, with room to spare |

### 8.2 Mapping onto the deep-wiki shell

The app shell is **navigation tree · document · contextual panel** (comments / AI / presence).

Checklist §6 already defines the three bands this product ships and what must be true in each. **That section is the authority — this table exists only to name which M3 class each band corresponds to, and to say what the *navigation surface* becomes.** Do not restate §6's requirements here or in a PR; go read them.

| Checklist §6 band | Tailwind variant | M3 class | Navigation surface | Panes visible |
| --- | --- | --- | --- | --- |
| Narrow (<768px) | *(base)* | Compact | Modal navigation **drawer** — focus-trapped, closes on select and on Escape | 1 |
| Medium (768–1279px) | `md:` | Expanded | Persistent navigation **rail** or collapsed tree | 2 (contextual panel overlays) |
| Wide (≥1280px) | `xl:` | Large / Extra-large | Persistent navigation **drawer** (the full tree) | 3 |

**Ruling on breakpoints.** Use Tailwind's `md` (768px) and `xl` (1280px) as the pane-count switches. Do **not** introduce M3's 600 / 840 / 1200 / 1600dp breakpoints. Checklist §6 specifies 768 and 1280, its e2e verification points are 320 / 768 / 1280, and the checklist wins on responsive behaviour. Two breakpoints that are tested beat five that are not.

### 8.3 In this stack

Nuxt UI v4 ships the shell components in the free package:

| Need | Component |
| --- | --- |
| Shell container | `UDashboardGroup` |
| Navigation pane | `UDashboardSidebar` (+ `UDashboardSidebarToggle`, `UDashboardSidebarCollapse`) |
| Document / contextual pane | `UDashboardPanel` |
| Pane top bar | `UDashboardNavbar` |
| Resizable pane divider | `UDashboardResizeHandle` or `USplitter` |
| Command palette | `UDashboardSearch` + `UDashboardSearchButton`, or `UCommandPalette` |
| Page tree | `UTree` (supports `virtualize`, `nested`, `multiple`, `propagateSelect`) |
| Narrow-viewport drawer | `USlideover` (or `UDrawer` for a bottom sheet) |

`UDashboardGroup` handles the collapse/expand state and emits `dashboard:sidebar:toggle`, `dashboard:sidebar:collapse` and `dashboard:search:toggle` hooks. `UTree`'s `virtualize` option is the answer to the checklist's "a book with 400 pages" extreme.

Surfaces, per §1.4:

| Region | Utility |
| --- | --- |
| App ground behind the panes | `bg-muted` |
| Navigation pane | `bg-elevated` |
| Document pane | `bg-default` |
| Contextual panel | `bg-elevated` |
| Pane dividers | `border-default` (`outline-variant`) |
| Sticky pane top bar | `bg-elevated` — no shadow (§4.3) |

**Do**
- Use the `UDashboard*` set. It exists, it is free, and it already handles the collapse states.
- Give each pane its container tone from §1.4 and let tone do the separation.
- Virtualize the tree.

**Don't**
- Don't invent breakpoints. `md:` and `xl:`.
- Don't let the document pane stretch to fill at wide widths — `max-w-measure` (§2.4), then centre.
- Don't put a shadow on a pane edge. Use `border-default`.

---

## 9. Component guidance

Values are the M3 v0.192 component tokens, with the Nuxt UI equivalent and the ruling for this project.

### 9.1 Buttons — the hierarchy, and when each is correct

M3 defines five button styles in a strict emphasis order. Getting this order right is most of what makes a screen read correctly.

| M3 button | Container | Label | Elevation | Emphasis | Use for |
| --- | --- | --- | --- | --- | --- |
| **Filled** | `primary` | `on-primary` | 0 | Highest | The single primary action. **One per screen** — checklist §2. |
| **Filled tonal** | `secondary-container` | `on-secondary-container` | 0 | High | The second-most-important action; a primary action in a context that already has one elsewhere |
| **Elevated** | `surface-container-low` | `primary` | 1 | Medium | A button that needs separation from a busy or image background. Rare here. |
| **Outlined** | transparent + `outline` 1px | `primary` | 0 | Medium | Secondary actions that still need a visible boundary — Cancel next to a Filled Save |
| **Text** | transparent | `primary` | 0 | Low | Tertiary and in-place actions; dialog actions; low-risk links |

All five: 40dp height, `corner-full` (this project uses `corner-medium` — §3.3), `label-large`, 18dp leading icon.

**Mapping to `UButton` variants:**

| M3 button | `UButton` | Notes |
| --- | --- | --- |
| Filled | `variant="solid"` | `bg-primary text-inverted` |
| Filled tonal | `variant="soft"` **with the container tokens** | See ruling below |
| Elevated | — | No equivalent; do not build one. Use `solid` or `soft`. |
| Outlined | `variant="outline"` | |
| Text | `variant="ghost"` | Nuxt UI's `ghost` is M3's Text button |
| — | `variant="subtle"` | Nuxt UI extra: `soft` plus a ring. Use as a quieter Outlined. |
| — | `variant="link"` | Inline text link. Not an M3 button; use for navigation, never for an action. |

**Ruling on filled tonal.** Nuxt UI's `soft` is `bg-primary/10 text-primary` — alpha over an unknown background, which fails §1.4's rule. Override it once to use the opaque container tokens:

```ts
// app.config.ts
ui: {
  button: {
    compoundVariants: [
      { variant: 'soft', color: 'primary',
        class: 'bg-primary-container text-on-primary-container hover:bg-primary-container active:bg-primary-container' }
    ]
  }
}
```

**Deviation (2026-09-14): this project's filled tonal button carries a 1px inset ring in the accent colour. M3's does not.** The override above is exactly what shipped until the cross-screen audit measured it: `variant="soft"` at **1.02:1** on a `PageNotice`, **1.09:1** on the app bar and **1.00:1** as a diff badge on its own container row. The cause is structural, not a wrong token — M3's `secondary-container` and this project's container rungs (§1.4) are drawn from the same tone band, so wherever a tonal control lands on a container it stops being a control. The fix lives in one place, `apps/web/app/app.config.ts`:

```ts
const TONAL_BOUNDARY = 'ring ring-inset';
const tonalFill = (color: string) =>
  `bg-${color}-container text-on-${color}-container ${TONAL_BOUNDARY} ring-${color}`;
// applied to variant: 'soft' and variant: 'subtle' on UButton and UBadge, every chromatic alias
```

The ring is the `outline` role — the same ground-independent boundary §9.5 gives the outlined field and the table above gives the Outlined button — in the accent itself, not a shade step (`ring-<color>-300`/`-600`, what `subtle` used to draw, measured **1.77:1 / 1.50:1** against the fill) and not a tone step (tone 80 on tone 90 is **1.33:1**, and darker fails the label). Measured from the tone tables in `main.css` with the accent at tone 40 light / 70 dark: the ring is **≥ 4.47:1** against the fill and **≥ 4.77:1** against every surface rung, in both themes, for every alias, while the label stays the `on-container` pair at ≥ 7.3:1. `e2e/read.spec.ts` measures the app bar's "Edit" in the running browser in both themes, so this cannot regress by a token rename. Consequences: `soft` and `subtle` are now the same variant; a tonal control needs no surface-aware call site, and a screen chooses `soft` for emphasis, never for ground. The alternative — a tonal rung that is never a container rung — would cost the sixth surface level §1.4 forbids. Recorded in §14.

**Destructive actions** use `color="error"` and `variant="solid"` or `variant="outline"`, never `ghost` — a destructive action must have a visible boundary. Checklist §3 requires a stronger confirmation than a 3s toast; that is a flow rule, not a button rule.

Every icon-only button needs `aria-label` **and** a tooltip (checklist §4.3). `UButton` with `square` and a `UTooltip` wrapper.

### 9.2 Navigation rail and drawer

| | M3 spec | Nuxt UI | Ruling |
| --- | --- | --- | --- |
| Rail width | 80dp | — | 64px; deep-wiki's rail carries at most 6 destinations |
| Rail container | `surface`, elevation 0, `corner-none` | `bg-elevated` | Use `bg-elevated` so the rail separates from the app ground by tone |
| Rail active indicator | 56 × 32dp, `corner-full`, `secondary-container` | `UNavigationMenu variant="pill"` | Pill variant is the active indicator |
| Rail label | `label-medium` (12px) | `text-label-medium` | |
| Drawer width | 360dp | — | 280px (§7.2) |
| Drawer shape | `corner-large-end` (0 16 16 0) | `rounded-e-lg` | Only when modal; the persistent drawer is edge-to-edge, `rounded-none` |
| Drawer active indicator | 336 × 56dp, `corner-full`, `secondary-container` | `UTree` selected state | 40px tall (§7.2) |
| Drawer item label | `label-large` | `text-label-large` | |
| Drawer section headline | `title-small`, `on-surface-variant` | `text-title-small text-muted` | |

The page tree is `UTree`, not a hand-rolled list. It brings keyboard navigation, `aria-*` wiring, expand/collapse state and virtualization — all of which checklist §5 and §6 require.

Long titles truncate with the full title available on hover and focus (checklist §6). `UTree`'s `linkLabel` slot is already `truncate`; add a `UTooltip`.

### 9.3 Top app bar

| Property | M3 (small) | Nuxt UI |
| --- | --- | --- |
| Height | 64dp | `--ui-header-height: 3.5rem` (56px, §7.2) |
| Container | `surface`, elevation 0 | `bg-elevated` |
| Shape | `corner-none` | `rounded-none` |
| Headline | `title-large` | `text-title-large` |
| Medium variant headline | `headline-small` | `text-headline-small` |

Use `UDashboardNavbar` per pane rather than one global bar — in a three-pane shell each pane owns its own actions.

Sticky bars must not obscure anchored content (checklist §6): set `scroll-margin-top` on headings to the bar height.

### 9.4 Cards

| M3 card | Container | Elevation | Nuxt UI |
| --- | --- | --- | --- |
| Elevated | `surface-container-low` | 1 | — (avoid; see §4.3) |
| Filled | `surface-container-highest` | 0 | `UCard variant="soft"` → retarget to `bg-emphasized` |
| Outlined | `surface`, 1px `outline-variant` | 0 | `UCard variant="outline"` (the default) |

All: `corner-medium` (12px). `UCard`'s stock `rounded-lg` with `--ui-radius: 0.5rem` is 16px = `corner-large`, one step up. **Ruling: accept it.** 16px on a card is within M3's own range (dialogs are 28px) and changing it fights the library for no user-visible gain.

`UCard` has slots `root header title description body footer` and variants `solid outline soft subtle`. There is no `color` or `size` prop.

**Ruling: outlined by default.** A wiki's cards sit inside panes that already carry a container tone; an elevated card inside a toned pane is two hierarchy signals for one level. `UCard variant="outline"` — the library default — is correct.

**Ruling: a container sitting directly on the app ground is the Filled card — `UCard variant="soft"`, retargeted to `bg-emphasized`.** Added 2026-09-06. The rule above answers the case where the card is inside a pane and says nothing about the case where there is no pane, which is every screen the product has today: the auth card, the two panels on `/`, the panel a screen shows instead of its content, and the navigation tree when it is a column rather than a pane. Outlined there is a container on `bg-muted` with nothing but an `outline-variant` hairline to say so — 1.14:1 in dark before the tone fix, and still the weakest separation available. Filled is a full rung.

Two corollaries, both of which were violated before this was written down:

- **Never `bg-elevated`.** That rung is chrome — §1.4 gives it to the navigation pane, the contextual panel and the top app bar, and `app.config.ts` gives it to `UHeader` and `UFooter`. A content container drawn at `bg-elevated` measures *identical* to the header above it and reads as chrome. This is §12.1 arriving one rung at a time. §1.4's row naming the navigation tree is about the tree **as a pane**; the same tree rendered as a column on its own screen is a container on the app ground and takes the Filled card like any other.
- **Never hand-rolled.** `div.rounded-lg.bg-*.ring.ring-default.p-4.sm:p-6` is `UCard` with the tone chosen by eye instead of read from a ruling, and it is how one screen ends up a rung away from another (checklist §4.1).

What goes *inside* a filled card steps **down**, not up: `bg-default` is the recessed rung (tone 100 light / 4 dark) and is what the text fields on the auth card already use. There is no rung above `bg-emphasized` — §1.4 forbids a sixth surface level — so an inset drawn at `bg-emphasized` inside a filled card is invisible by construction.

### 9.5 Text fields

| Property | M3 (outlined) | deep-wiki | Nuxt UI |
| --- | --- | --- | --- |
| Shape | `corner-extra-small` (4px) | **`corner-medium` (12px)** — deviation, §3.4 | `rounded-md` with `--ui-radius: 0.5rem` |
| Height | 56dp | 56px | `h-14` on the `base` slot |
| Outline | 1px `outline` | unchanged | `ring ring-inset ring-accented` |
| Focus outline | **2px** `primary` | unchanged | `focus-visible:ring-primary` + `focus-visible:outline-3` |
| Input text | `body-large` (16px) | unchanged — **non-negotiable** | `size="xl"` |
| Label | `body-large`, `on-surface-variant` | unchanged | `text-base text-muted` |
| Supporting text | `body-small`, `on-surface-variant` | unchanged | `text-body-small text-muted` |

#### The shape ruling, and why it is a deviation rather than a correction

**Ruling: text fields take `corner-medium` (12px), not M3's `corner-extra-small` (4px).**

Say plainly what this is. §3.2 establishes, from the token files, that current M3 — Expressive included — still specifies 4px for the outlined field container and `corner-extra-small-top` for the filled one, and that the `Shapes.kt` KDoc which carries the Expressive additions still names text fields under `extraSmall`. **M3 did not change. This project is changing.** Anyone citing "M3 Expressive rounded the text field" is citing something that does not exist.

The reason to deviate anyway is that this project already deviated once, in the opposite direction, and left the result half-applied:

| Object | M3 | deep-wiki before | Gap |
| --- | --- | --- | --- |
| Auth card | `corner-medium` 12px | `rounded-lg` 16px (§9.4, accepted) | — |
| Primary button | `corner-full` | `rounded-md` 12px (§3.3, deliberate) | −∞ → 12 |
| Text field | `corner-extra-small` 4px | `rounded-xs` 4px (M3 literal) | unchanged |

M3's 4px field is calibrated against an M3 button at `corner-full`. The two are meant to read as *different kinds of object*, and the huge distance between them is the signal. §3.3 pulled the button down to 12px for a dense keyboard-driven tool — a defensible call — and by doing so collapsed the distance the 4px field was contrasting against. What was left is 4 / 12 / 16 on one small form: three rungs, no relationship between them, and a field whose corner is a quarter of its container's. That is the residue of the button decision, not of M3.

§3.4's two-rung direction resolves it: **controls at `corner-medium`, containers at `corner-large`.** The field joins the button. The card stays one rung up. Two idioms, adjacent on the scale, ordered so a control is never rounder than what holds it.

Three things make this the conservative move rather than an indulgence:

1. **12px is a real M3 token** (`corner-medium`), reached through `rounded-md` on the existing ladder. No arbitrary value, no §12.3 failure.
2. **It is below Expressive's own proportional shape for a control of this height.** §3.2's button table scales the square corner with height: 40dp → 12px, 56dp → 16px. The M3 field is a 56dp control. 12px is the smaller of the two candidates.
3. **It is what Nuxt UI already ships.** `UInput`'s stock `base` is `rounded-md`; the previous 4px was an override this project added. So is every other member of the family. The fix is the removal of a special case, not the addition of one.

What this ruling does *not* license: rounding a container to match its contents, or flattening every radius on a screen to a single number. Shape still identifies the component (§3.4).

#### The filled-vs-outlined ruling — re-examined, and it holds

`UInput` variants are `outline | soft | subtle | ghost | none` (default `outline`) — note there is **no `solid`**. M3's outlined text field is `variant="outline"`; M3's filled text field is `variant="subtle"`.

**Ruling: outlined everywhere. Reaffirmed 2026-09-06, now for a measured reason rather than a stylistic one.**

M3's filled text field container is `surface-container-highest` (`FilledTextFieldTokens.kt`, `ContainerColor = ColorSchemeKeyTokens.SurfaceContainerHighest`). On this project's ladder that is `bg-emphasized` — tone 90 light, tone 22 dark. Now look at what the field would sit on:

| Ground | Tone (light / dark) | Filled field at tone 90 / 22 | Separation |
| --- | --- | --- | --- |
| Auth card — `UCard variant="soft"` → `bg-emphasized` | 90 / 22 | 90 / 22 | **zero — identical tone** |
| Contextual panel, nav pane — `bg-elevated` | 94 / 12 | 90 / 22 | 4 tones / 10 tones |
| Dialog, menu, palette — `bg-accented` | 92 / 17 | 90 / 22 | 2 tones / 5 tones |
| Document canvas — `bg-default` | 100 / 4 | 90 / 22 | 10 / 18 tones |

The auth card is the case the review was about, and it is the worst one: §9.4 puts the auth card on M3's *Filled* card, which is `surface-container-highest` — **the same role M3 gives the filled text field**. A filled field on this card is invisible by construction. And there is no rung above `bg-emphasized` to promote it to; §1.4 forbids a sixth surface level.

That is not a fixable detail. M3's filled field assumes the field is the topmost toned thing on the screen. In a three-pane tool, forms live inside panes and dialogs that have already spent the ladder. Outlined uses the `outline` role — a 3:1 boundary that is independent of the ground it is drawn on — and therefore works identically on all five rungs.

A secondary point, for anyone arriving with a reference screenshot: M3's filled field is `corner-extra-small-**top**` — 4px on the top corners, **square on the bottom**. A filled field is the *least* rounded thing in the M3 catalogue, not the most. A reference showing generously rounded filled fields is a themed product, not stock M3, and it is evidence for the shape ruling above rather than for the fill.

#### The 16px rule, and the ordering trap

16px input text is not negotiable: below 16px, iOS Safari zooms the viewport on focus. This is a property of any text-entry control, not of `UInput`.

**None of this comes for free.** Nuxt UI's defaults render a 32px-tall field with 14px text. Set it centrally in `app.config.ts`:

```ts
input: {
  slots: { base: 'h-14 rounded-md' },   // 56dp (§7) · corner-medium (§3.4)
  defaultVariants: { size: 'xl' },      // the size whose text is 16px
},
formField: {
  slots: { label: 'text-base text-muted' },  // library default is 14px
},

// The rest of the family. Shape needs no restating — Nuxt UI already ships
// every one of these at `rounded-md` — but none of them defaults to 16px.
// `h-14` only on the single-line controls: a textarea's height is its rows,
// and `UInputTags` grows as tags wrap.
textarea:    { defaultVariants: { size: 'xl' } },
inputTags:   { defaultVariants: { size: 'xl' } },
select:      { slots: { base: 'h-14' }, defaultVariants: { size: 'xl' } },
selectMenu:  { slots: { base: 'h-14' }, defaultVariants: { size: 'xl' } },
inputMenu:   { slots: { base: 'h-14' }, defaultVariants: { size: 'xl' } },
inputNumber: { slots: { base: 'h-14' }, defaultVariants: { size: 'xl' } },
```

The size variant is applied **after** the slot override, so `text-base` written on `base` loses to the variant's own font size. The size must be **chosen**, not overridden — this is the trap that shipped 14px text past a design review. It is also why the family entries above set `size`, not a font class.

Every input has a programmatically associated label; placeholder is not a label (checklist §5). `UFormField` provides the association — use it.

### 9.6 Menus, dialogs, snackbars, tooltips

| Component | M3 container | M3 elevation | M3 shape | M3 text | Nuxt UI |
| --- | --- | --- | --- | --- | --- |
| Menu | `surface-container` | 2 | `corner-extra-small` | — | `UDropdownMenu` — `bg-default shadow-lg rounded-md ring-default` |
| Dialog | `surface-container-high` | 3 | `corner-extra-large` (28px) | `headline-small` + `body-medium` | `UModal` |
| Snackbar | `inverse-surface` | 3 | `corner-extra-small` | `body-medium`; action `inverse-primary`, `label-large` | `UToast` / `useToast()` |
| Plain tooltip | `inverse-surface` | — | `corner-extra-small` | `body-small` | `UTooltip` — `bg-default text-highlighted shadow-sm rounded-sm ring-default` |
| Rich tooltip | `surface-container` | 2 | `corner-medium` | `body-medium` | `UPopover` |
| Search bar / palette | `surface-container-high` | 3 | `corner-full`, 56dp | `body-large` | `UCommandPalette` / `UDashboardSearch` |

**Ruling on menus and dialogs.** Retarget the container to `bg-accented` (`surface-container-high`) via `app.config.ts` so overlays are tonally distinct from the panes behind them, and keep Nuxt UI's `shadow-lg`:

```ts
ui: {
  dropdownMenu: { slots: { content: 'bg-accented' } },
  modal:        { slots: { content: 'bg-accented' } },
  popover:      { slots: { content: 'bg-accented' } }
}
```

**Ruling on tooltips — a genuine conflict.** M3 puts plain tooltips on `inverse-surface` (a dark chip in light mode). Nuxt UI puts them on `bg-default` with a ring. *Nuxt UI's primitive wins.* `UTooltip` is used heavily here — every icon-only button in every toolbar requires one (checklist §4.3) — and a field of dark chips flickering over a light document is worse than a mildly non-M3 tooltip. Keep `bg-default`. **Snackbars do not keep `inverse-surface` either, since 2026-09-23** — that ruling rested on their being rare, and once every save, creation and invitation is confirmed in one they are not; a toast takes `bg-accented` like every other overlay above, and the reasoning and the two measurements behind it are in §14. The retargeting is in `app.config.ts` beside the three in the code block above, and the tier's own rule — what may be said in a toast at all — is `docs/UI-CHECKLIST.md` §4.12.

All Reka-backed overlays (`UModal`, `USlideover`, `UPopover`, `UDropdownMenu`, `UCommandPalette`) bring focus trapping, focus return and Escape handling. Hand-rolling any of them forfeits checklist §5 and is an automatic fail.

### 9.7 Chips, badges, tooltips on data

| Component | M3 | Nuxt UI |
| --- | --- | --- |
| Chip | 32dp, `corner-small` (8px), `label-large` | `UBadge` for static, `UButton size="xs"` for interactive filter chips |
| Badge (dot) | 6dp, `corner-full`, `error` | `UChip` (Nuxt UI's `UChip` is M3's badge — note the naming inversion) |
| Badge (numbered) | 16dp, `label-small` | `UChip` with content |

**Naming trap:** Nuxt UI's `UChip` is M3's *badge* (an indicator dot on another element); Nuxt UI's `UBadge` is M3's *chip* (a labelled pill). Read the component, not the name.

`UBadge` variants: `solid | outline | soft | subtle` — no `ghost`, no `link`. Sizes `xs | sm | md | lg | xl`.

**Deviation (2026-09-14): a `soft`/`subtle` `UBadge` carries the same 1px inset accent ring as the tonal button (§9.1).** A diff badge measured **1.00:1** on the container row it labelled — the row and the badge were painted the same token, so the label read as text, not as a chip. M3's chip is *outlined* by default, so the ring on a badge is M3's own shape and the deviation is against Nuxt UI's `soft`, not against M3. Same `tonalFill()` in `app.config.ts`, same measurements as §9.1; a badge is legible on every rung without the call site knowing which rung it is on. Recorded in §14.

Colour is never the sole carrier of meaning (checklist §5). A badge that means "pending revision" carries an icon or a word too.

### 9.8 Lists

| Property | M3 | deep-wiki |
| --- | --- | --- |
| Label | `body-large` | `text-body-large`, or `text-body-medium` in dense panes |
| Supporting text | `body-medium` | `text-body-medium text-muted` |
| Overline / trailing meta | `label-small` | `text-label-small text-muted` |
| Leading icon | 24dp | 20px in dense panes |
| Leading avatar | 40dp | 24px in dense panes |
| Leading / trailing space | 16dp | 12px in dense panes |
| Row height | 56 / 72 / 88dp (1/2/3 line) | 32 / 40 / 56px (§7.2) |

Every row is a `dw-state-layer` (§5.2) or a Nuxt UI component that already provides one.

---

## 10. Accessibility within M3

### 10.1 What the colour roles give you for free

M3's tonal system is built so that a correctly-paired role gives you a passing contrast ratio without measuring:

| Pair | Tone gap | Guarantee |
| --- | --- | --- |
| `on-primary` on `primary` | 100 vs 40 (light), 20 vs 80 (dark) | ≥ 4.5:1 |
| `on-primary-container` on `primary-container` | 30 vs 90 (light), 90 vs 30 (dark) | ≥ 4.5:1 |
| `on-surface` on `surface` | 10 vs 98 (light), 90 vs 6 (dark) | ≥ 4.5:1 (very large margin) |
| `on-surface-variant` on `surface` | 30 vs 98 (light), 80 vs 6 (dark) | ≥ 4.5:1 |
| `outline` on `surface` | 50 vs 98 (light), 60 vs 6 (dark) | ≥ 3:1 — valid as a control boundary |
| `on-error-container` on `error-container` | 30 vs 90 / 90 vs 30 | ≥ 4.5:1 |

The rule of thumb behind it: **a tone gap of 40 or more clears 3:1; a gap of 50 or more clears 4.5:1.** That is what makes the `on-` pairing mechanical rather than a judgement call.

The corollary is the trap: **`outline-variant` deliberately does not clear 3:1.** Tone gap is 18 (80 vs 98) in light. It is a decorative divider, not a boundary. Using `border-default` as a text-field or button boundary produces a control the user cannot see the edge of.

### 10.2 Where M3 alone is not enough

M3's guarantees are about the *default* light and dark schemes at default contrast. They do not survive:

| Situation | Why M3 does not cover it | What the checklist requires |
| --- | --- | --- |
| **User-selectable themes** | M3 guarantees hold for a scheme generated by its own algorithm. A hand-authored deep-wiki theme can break every pair. | Verify contrast in **every theme shipped**, not just the default — §4.2 and §5 |
| **Mixed roles** | Nothing stops `text-primary` on `bg-elevated`. That pair has no guarantee. | Measure any pair that is not an `on-`/container pair |
| **Alpha compositing** | `bg-primary/10` has no defined contrast; it depends on what is behind it. | This file's §1.4 bans it for containers |
| **Focus visibility** | M3 specifies the ring but not that it must be visible on every theme. | §5: focus visible in every theme, pass/fail |
| **Non-text meaning** | M3 has no rule against colour-only signalling. | §5: diff add/remove, presence, validation and pending-revision all need a second signal |
| **Target size** | M3's 24dp icon in a 32dp container is fine on touch; a 20px icon button in a dense toolbar is not. | §5: ≥ 24×24 CSS px with spacing between adjacent targets |
| **Generated content** | Mermaid and D2 render their own colours. M3 has nothing to say. | §4.2: diagram surfaces readable in every theme |
| **Zoom and reflow** | M3 is dp-based and assumes a fixed density. | §6: no fixed-height clipping at 200% zoom |
| **Announcements** | M3 does not cover live regions. | §5: save, streaming start/stop, error and permission-denied announced |

M3 gives you a colour system that is accessible **by construction** when used exactly as specified. It gives you nothing once a theme author, an alpha value, or a generated diagram enters the picture — which in this product is constantly. The checklist is where that gap is closed.

---

## 11. The copy-pasteable token block

Everything above, in the order it must appear in `apps/web/app/assets/css/main.css`. Palette tone values are placeholders — generate them once per theme from a source colour.

```css
/* apps/web/app/assets/css/main.css */

@import "tailwindcss";
@import "@nuxt/ui";

/* ─────────────────────────────────────────────────────────────
   1. TONAL PALETTES
   One tone table per palette. Shade slot ← M3 tone:
   50←95 100←90 200←80 300←70 400←60 500←50 600←40 700←30 800←20 900←10 950←0
   `static` is required: Nuxt UI references every shade whether or not
   it appears in markup.
   ───────────────────────────────────────────────────────────── */
@theme static {
  --color-dw-primary-50:  /* tone 95 */ ;
  --color-dw-primary-100: /* tone 90 */ ;
  --color-dw-primary-200: /* tone 80 */ ;
  --color-dw-primary-300: /* tone 70 */ ;
  --color-dw-primary-400: /* tone 60 */ ;
  --color-dw-primary-500: /* tone 50 */ ;
  --color-dw-primary-600: /* tone 40 */ ;
  --color-dw-primary-700: /* tone 30 */ ;
  --color-dw-primary-800: /* tone 20 */ ;
  --color-dw-primary-900: /* tone 10 */ ;
  --color-dw-primary-950: /* tone 0  */ ;
  /* …repeat for dw-secondary, dw-error, dw-neutral… */
}

/* ─────────────────────────────────────────────────────────────
   2. THE M3 SURFACE LADDER
   The extra neutral tones exist only to feed surface-container-*.
   ───────────────────────────────────────────────────────────── */
:root, :host, .light {
  --dw-neutral-tone-98: ;  --dw-neutral-tone-94: ;
  --dw-neutral-tone-92: ;  --dw-neutral-tone-90: ;
}
.dark {
  --dw-neutral-tone-4:  ;  --dw-neutral-tone-10: ;
  --dw-neutral-tone-12: ;  --dw-neutral-tone-17: ;
  --dw-neutral-tone-22: ;
}

/* ─────────────────────────────────────────────────────────────
   3. SEMANTIC ROLES ON TOP OF NUXT UI'S PRIMITIVES
   ───────────────────────────────────────────────────────────── */
:root, :host {
  --ui-radius: 0.5rem;        /* §3.3 — lands the ladder on the M3 shape scale */
  --ui-header-height: 3.5rem; /* §7.2 */
}

:root, :host, .light {
  /* accent: M3 tone 40 */
  --ui-primary:   var(--ui-color-primary-600);
  --ui-secondary: var(--ui-color-secondary-600);
  --ui-error:     var(--ui-color-error-600);

  /* accent containers: M3 tone 90 / on-tone 30 */
  --ui-primary-container:      var(--ui-color-primary-100);
  --ui-on-primary-container:   var(--ui-color-primary-700);
  --ui-secondary-container:    var(--ui-color-secondary-100);
  --ui-on-secondary-container: var(--ui-color-secondary-700);
  --ui-error-container:        var(--ui-color-error-100);
  --ui-on-error-container:     var(--ui-color-error-700);

  /* surface ladder: tones 100 / 98 / 94 / 92 / 90 */
  --ui-bg:            #fff;
  --ui-bg-muted:      var(--dw-neutral-tone-98);
  --ui-bg-elevated:   var(--dw-neutral-tone-94);
  --ui-bg-accented:   var(--dw-neutral-tone-92);
  --ui-bg-emphasized: var(--dw-neutral-tone-90);
}

.dark {
  /* accent: M3 tone 80 */
  --ui-primary:   var(--ui-color-primary-200);
  --ui-secondary: var(--ui-color-secondary-200);
  --ui-error:     var(--ui-color-error-200);

  /* accent containers: M3 tone 30 / on-tone 90 */
  --ui-primary-container:      var(--ui-color-primary-700);
  --ui-on-primary-container:   var(--ui-color-primary-100);
  --ui-secondary-container:    var(--ui-color-secondary-700);
  --ui-on-secondary-container: var(--ui-color-secondary-100);
  --ui-error-container:        var(--ui-color-error-700);
  --ui-on-error-container:     var(--ui-color-error-100);

  /* surface ladder: tones 4 / 10 / 12 / 17 / 22
     NOTE: this override is mandatory. Nuxt UI's dark defaults collapse
     --ui-bg-muted and --ui-bg-elevated to the same value. */
  --ui-bg:            var(--dw-neutral-tone-4);
  --ui-bg-muted:      var(--dw-neutral-tone-10);
  --ui-bg-elevated:   var(--dw-neutral-tone-12);
  --ui-bg-accented:   var(--dw-neutral-tone-17);
  --ui-bg-emphasized: var(--dw-neutral-tone-22);
}

/* ─────────────────────────────────────────────────────────────
   4. REGISTER THE NEW ROLES AS UTILITIES
   `inline` is mandatory — the values are vars redefined per theme.
   ───────────────────────────────────────────────────────────── */
@theme inline {
  --color-primary-container:      var(--ui-primary-container);
  --color-on-primary-container:   var(--ui-on-primary-container);
  --color-secondary-container:    var(--ui-secondary-container);
  --color-on-secondary-container: var(--ui-on-secondary-container);
  --color-error-container:        var(--ui-error-container);
  --color-on-error-container:     var(--ui-on-error-container);
  --background-color-emphasized:  var(--ui-bg-emphasized);
}

/* ─────────────────────────────────────────────────────────────
   5. TYPE SCALE  (§2.5 — full block reproduced there)
   ───────────────────────────────────────────────────────────── */
@theme static {
  --text-headline-medium: 1.75rem;
  --text-headline-medium--line-height: 2.25rem;
  --text-headline-medium--letter-spacing: 0rem;
  --text-headline-medium--font-weight: 400;
  /* …headline-large/small, title-*, body-*, label-*… */

  --text-doc-body: 1rem;
  --text-doc-body--line-height: 1.625rem;
  --text-doc-body--letter-spacing: 0.03125rem;
  --text-doc-body--font-weight: 400;

  --container-measure: 72ch;
}

/* ─────────────────────────────────────────────────────────────
   6. MOTION  (§6.5)
   ───────────────────────────────────────────────────────────── */
@theme {
  --ease-standard:              cubic-bezier(0.2, 0, 0, 1);
  --ease-standard-accelerate:   cubic-bezier(0.3, 0, 1, 1);
  --ease-standard-decelerate:   cubic-bezier(0, 0, 0, 1);
  --ease-emphasized:            cubic-bezier(0.2, 0, 0, 1);
  --ease-emphasized-accelerate: cubic-bezier(0.3, 0, 0.8, 0.15);
  --ease-emphasized-decelerate: cubic-bezier(0.05, 0.7, 0.1, 1);
}

/* ─────────────────────────────────────────────────────────────
   7. ELEVATION SHADOWS  (§4.4)
   ───────────────────────────────────────────────────────────── */
@theme {
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.30), 0 1px 3px 1px rgb(0 0 0 / 0.15);
  --shadow-md: 0 1px 2px 0 rgb(0 0 0 / 0.30), 0 2px 6px 2px rgb(0 0 0 / 0.15);
  --shadow-lg: 0 1px 3px 0 rgb(0 0 0 / 0.30), 0 4px 8px 3px rgb(0 0 0 / 0.15);
}

/* ─────────────────────────────────────────────────────────────
   8. STATE LAYER UTILITY  (§5.2) — only where no Nuxt UI
      component already provides one.
   ───────────────────────────────────────────────────────────── */
@utility dw-state-layer {
  position: relative;
  isolation: isolate;
  &::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background-color: currentColor;
    opacity: 0;
    transition: opacity 100ms var(--ease-standard);
  }
  &:hover::before         { opacity: 0.08; }
  &:focus-visible::before { opacity: 0.12; }
  &:active::before        { opacity: 0.12; }
}

/* ─────────────────────────────────────────────────────────────
   9. REDUCED MOTION  (§6.6 — checklist §5 is pass/fail on this)
   ───────────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

And the matching `app.config.ts`:

```ts
// apps/web/app/app.config.ts
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'dw-primary',
      secondary: 'dw-secondary',
      error: 'dw-error',
      neutral: 'dw-neutral'
    },
    button: {
      slots: {
        // M3 Expressive shape morph on press (§3.3)
        base: 'transition-[border-radius,background-color] duration-100 ease-standard active:rounded-sm'
      },
      compoundVariants: [
        // M3 filled: state layer as a currentColor overlay, never a shade step
        // and never alpha on the fill (§5.2, superseded ruling — see §14)
        { variant: 'solid', color: 'primary',
          class: 'bg-primary text-inverted hover:bg-primary-500 active:bg-primary-400 dark:hover:bg-primary-100 dark:active:bg-primary-50' },
        // M3 filled tonal: opaque container tokens, not alpha (§9.1)
        { variant: 'soft', color: 'primary',
          class: 'bg-primary-container text-on-primary-container' },
        // M3 state layers: 0.08 hover, 0.12 pressed (§5.2 conflict 1)
        { variant: 'ghost',   color: 'primary', class: 'hover:bg-primary/8 active:bg-primary/12' },
        { variant: 'outline', color: 'primary', class: 'hover:bg-primary/8 active:bg-primary/12' }
      ]
    },
    // Overlays sit at surface-container-high (§9.6)
    dropdownMenu: { slots: { content: 'bg-accented' } },
    modal:        { slots: { content: 'bg-accented' } },
    popover:      { slots: { content: 'bg-accented' } }
  }
})
```

---

## 12. Common failures

The specific, recognisable ways generated UI violates M3. Each one is a review finding with a named correction.

### 12.1 Flat surfaces with no container-level hierarchy

**Symptom.** Every region — nav pane, document, contextual panel, cards, menus — is the same background colour, separated only by 1px borders. In dark mode the whole screen is one shade of near-black.

**Why it happens.** The generator reaches for `bg-white dark:bg-gray-900` and stops. The surface-container ladder was never in the picture.

**In this project it is worse than usual,** because Nuxt UI's stock dark theme sets `--ui-bg-muted` and `--ui-bg-elevated` to the same value — two of five rungs already collapsed before anyone wrote a line.

**Correction.** §1.4. Walk `bg-default → bg-muted → bg-elevated → bg-accented → bg-emphasized`, and fix the dark ladder in every theme.

### 12.2 Missing state layers

**Symptom.** Hovering a tree row does nothing, or changes colour by an amount you have to squint to see. Pressing a button produces no feedback. The whole interface feels like a screenshot.

**Why it happens.** State is invisible in the artefact the generator was optimising for. Also: Nuxt UI's defaults set `hover:` and `active:` to the *same* value, so even correct library usage yields no pressed state.

**Correction.** §5.2. Every interactive element gets 0.08 hover / 0.12 focus / 0.12 pressed, plus the Expressive shape morph on press. Add it once in `app.config.ts`, not per component.

### 12.3 Arbitrary radii

**Symptom.** `rounded-[10px]` here, `rounded-xl` there, a card at 14px and its own button at 6px. Nothing lines up.

**Why it happens.** Radius was chosen per element by eye instead of read from a scale.

**Correction.** §3.3. Set `--ui-radius: 0.5rem` once; use only `rounded-none | xs | sm | md | lg | 2xl | 3xl | full`. Never mix radii within one component.

### 12.4 Shadows instead of surface tones

**Symptom.** `shadow-md` on the sidebar, on cards, on the sticky header, on list rows. In dark mode all of it disappears and the layout goes flat.

**Why it happens.** Shadow is the reflex for "this is above that". M3 replaced it with tone six years ago.

**Correction.** §4.3. Shadows only on transient floating surfaces — menus, popovers, dialogs, drawers, toasts, drag previews. Nuxt UI already puts them exactly there. Everything persistent gets a container tone and a `border-default`.

### 12.5 One-size type

**Symptom.** Everything is 14px or 16px. `h2` and `h3` are the same size and differ only in weight. Metadata, body text and captions are indistinguishable. There is no scannable structure in a document that exists to be scanned.

**Why it happens.** A type scale was never defined, so each element got whatever size looked reasonable in isolation.

**Correction.** §2.3 and §2.5. Register the M3 roles as `--text-*` tokens; one role per element, one class per element. `h1`–`h3` separate by size; `h4`–`h6` separate by weight, tracking and colour.

### 12.6 Cramped or wildly generous spacing with no grid

**Symptom.** `p-3` next to `p-5` next to `py-[13px]`. A tree row at 56px next to a comment row at 28px. Or the opposite: a consumer-app density that fits nine tree items on a 27" monitor.

**Why it happens.** Spacing was tuned per element, and M3's touch-first dp values were either copied literally or abandoned entirely.

**Correction.** §7. Every project-authored spacing value is an integer multiple of 4px. Step density down one level from M3 for repeating rows, never below the 24×24 target minimum. Set pane-level density once with `UTheme`.

### 12.7 Decorative motion

**Symptom.** Cards fade up on scroll. The nav slides in on every route change. A gradient shimmers behind the page title. Nothing conveys information; everything costs 300ms.

**Why it happens.** Motion reads as polish in a demo. In a tool someone opens forty times a day it reads as latency.

**Correction.** §6. Motion communicates a state change or it does not exist. Exits shorter than entrances. No motion in the document body at all (checklist §4.4). Reduced-motion path verified with the OS setting on.

### 12.8 Alpha where an opaque token belongs

**Symptom.** `bg-primary/10` for a tonal container, `bg-black/5` for a hover row, `border-white/10` for a divider. Looks correct on the theme it was written against; wrong on every other one, and unpredictable wherever it overlaps something.

**Why it happens.** Alpha is the shortest path to "slightly tinted" and needs no token.

**Correction.** §1.4 and §5.2. Alpha is correct for a **state layer** over a known container. It is wrong for a **container fill**, a **border**, or **text**. Those get opaque tokens.

### 12.9 Icon-only controls with no name

**Symptom.** A toolbar of glyphs. No tooltip, no `aria-label`. Ambiguous in one icon pack, meaningless in another.

**Why it happens.** The icon looked self-explanatory to whoever picked it.

**Correction.** Checklist §4.3 and §5 — this is a pass/fail item there, not a matter of taste. Every icon-only button gets both an `aria-label` and a tooltip, and the screen is verified with two different icon packs.

### 12.10 Hand-rolled primitives

**Symptom.** A custom dropdown built from a `div` and a click-outside handler. A modal that does not trap focus. A tree built from nested `ul`s with `onclick`.

**Why it happens.** Building the visual is faster than finding the component.

**Correction.** Checklist §4.1. `UDropdownMenu`, `UModal`, `UTree`, `UCommandPalette`, `UPopover`, `UTooltip` all exist in the free package and all bring the focus trapping, focus return, `aria-*` wiring and keyboard handling that checklist §5 requires. A hand-rolled equivalent forfeits all of it and fails review.

---

## 13. Sources

Token values in this document are taken from the following, not from memory:

- `material-components/material-web` — `tokens/versions/v0_192/` (`md-sys-color`, `md-sys-typescale`, `md-sys-shape`, `md-sys-state`, `md-sys-motion`, `md-sys-elevation`, `md-ref-palette`, `md-ref-typeface`, and the `md-comp-*` component token files)
- `material-foundation/material-color-utilities` — `typescript/dynamiccolor/color_spec_2021.ts` (role → tone mapping), `variant.ts`
- `androidx/androidx` — `compose/material3/.../tokens/` (`ShapeTokens`, `TypeScaleTokens`, `StandardMotionTokens`, `ExpressiveMotionTokens`, `Button{XSmall,Small,Medium,Large,XLarge}Tokens`) for the M3 Expressive additions
- `androidx/androidx` — `compose/material3/material3/src/commonMain/kotlin/androidx/compose/material3/tokens/{OutlinedTextFieldTokens,FilledTextFieldTokens,ShapeTokens}.kt` and `.../material3/Shapes.kt`, read on `androidx-main` on **2026-09-06** for §3.2's text-field verification. `Shapes.kt`'s KDoc is the only machine-readable copy of M3's shape overview prose; `m3.material.io` renders that page in JavaScript and cannot be fetched.
- `material-components/material-web` — `tokens/_md-comp-outlined-field.scss` and `tokens/_md-comp-outlined-text-field.scss` (`top-space` / `bottom-space` 16px, `leading-space` / `trailing-space` 16px, `label-text-padding-bottom` 8px, `supporting-text-top-space` 4px, `content-space` 16px) and `dialog/internal/_dialog.scss` (headline `padding: 24px 24px 0`; content `padding: 24px` with `padding-bottom: 8px` before actions; actions `padding: 16px 24px 24px`), read on `main` on **2026-09-06** for §7.4's form rhythm. Dialog spacing is hardcoded in the component stylesheet, not exposed as tokens — `_md-comp-dialog.scss` carries colour and type only.
- `m3.material.io` — breakpoints, grids and spacing, tone-based surface colour. **Not fetchable**: it is a client-rendered SPA and returns an empty shell. Verify token claims against the platform token files above, never against a summary of this site.
- `tailwindcss.com/docs/theme` — `@theme` namespaces and options
- The installed `@nuxt/ui@4.11.0` package: `dist/runtime/index.css`, `dist/runtime/plugins/colors.js`, and the resolved component theme in `apps/web/.nuxt/ui/`

---

## 14. Change log

Amend this file in place when a rule turns out to be wrong, and record why here. A deviation from M3 that is not written down is a defect, not a decision.

| Date | Change | Reason |
| --- | --- | --- |
| 2026-09-03 | Initial version. | — |
| 2026-09-04 | §11: tone→lightness conversion stated explicitly; an M3 tone is a CIE L\*, not an oklch lightness. | Written as `oklch(<tone>%)`, tone 4 rendered at L\* 0.4 — effectively pure black. The dark auth card measured **1.14:1** against the page ground and read as a hole rather than a container. All tones recomputed from the exact transform; the card now measures 1.48:1. The document's own token block carried the error, so every future theme would have inherited it. |
| 2026-09-04 | Dark neutral container rungs moved up one M3 tone each (12→17, 17→22, 22→24). | Tones 10 and 12 measured **1.04:1** between the app ground and the header butting against it — the collapsed rung §1.4 exists to prevent. All replacement tones come from §1.1's list. |
| 2026-09-04 | Dark `--ui-primary` moves from tone 80 to tone 70. | M3 specifies tone 80 for dark primary, but at oklch L 0.84 / hue 262 the maximum sRGB chroma is 0.0793 and the palette already sat at 0.078 — the gamut ceiling, so the button could not be made less washed out at that tone. Tone 70 raises chroma to 0.120 (+54%) and still measures 6.35:1 against its label, above the §5 floor of 4.5:1. Deviates from M3 deliberately; the checklist wins on how a control reads. |
| 2026-09-03 | §5.2: `solid` pressed/hover states now use a `currentColor` compositing overlay instead of stepping the shade. | Measured against this project's tone tables, the shade step put a white label on tone 60 at 3.15:1, below the checklist's 4.5:1 floor. The checklist wins on accessibility per §0. One shade slot spans ten M3 tones, about 2.5x an 0.12 state layer, so the step overshoots. |
| 2026-09-06 | **New §3.4 — a two-rung shape direction for the product: controls at `corner-medium` (12px), containers at `corner-large` (16px).** | Owner rejected the auth form on review: the screen carried a 16px card, a 12px button and a 4px input — three shape idioms with no relationship. Investigated whether M3 sanctioned rounder fields; it does not (see the row below). It sanctions *choosing a direction*: M3's own shape prose is "shape… identifies components", and Expressive makes shape an adjustable axis, combinable "to generate visual tension or cohesion". The gap was self-inflicted — §3.3 had already moved buttons from `corner-full` to 12px, collapsing the contrast M3's 4px field exists to play against. Two adjacent, correctly-ordered rungs replace three unrelated ones. |
| 2026-09-06 | **§9.5: text field shape moves from `corner-extra-small` (4px) to `corner-medium` (12px). Recorded deviation from M3.** | An application of §3.4, not a correction to M3 — M3 still says 4px and this project no longer does. Mitigations: 12px is a real M3 token; it is *below* M3 Expressive's own square shape for a 56dp-tall control (16px), so it is the conservative candidate; and it is Nuxt UI's stock `UInput` radius, so the change removes a project override rather than adding one. Measured on `/login`: input, button and card now read 12 / 12 / 16px in both themes. |
| 2026-09-06 | §3.2: added the verification that **M3 Expressive did not change text-field shape**, with the token evidence. | The rejection rested on a belief that current M3 rounds its fields. It does not. `FilledTextFieldTokens.kt` is at token version **v0_210** — regenerated after this document's v0.192 baseline — and still emits `CornerExtraSmallTop`; `OutlinedTextFieldTokens.kt` still emits `CornerExtraSmall` at 56dp; `Shapes.kt`, the file that *carries* the Expressive additions, still names text fields under `extraSmall`; and no Expressive text-field token file exists. Recorded so the claim is not re-litigated from memory. |
| 2026-09-06 | §9.5: "outlined everywhere" **reaffirmed**, with a measured reason replacing the stylistic one. | The owner's reference showed *filled* fields. M3's filled field container is `surface-container-highest`, which on this ladder is `bg-emphasized` — and §9.4 already puts the auth card on that exact role. A filled field on the auth card would be **the same tone as the card**, with no rung above it to escape to (§1.4 forbids a sixth surface level). On `bg-elevated` it is 4 tones away, on `bg-accented` 2. The outlined field's `outline` role is ground-independent and holds 3:1 on all five rungs. Also noted: M3's filled field is `corner-extra-small-**top**` — square-bottomed, the least rounded thing in the catalogue — so a rounded filled field is evidence for the shape ruling, not for the fill. |
| 2026-09-06 | §9.5: `size: 'xl'` extended to `textarea`, `select`, `selectMenu`, `inputMenu`, `inputNumber`, `inputTags`. | The 16px floor is a property of text entry, not of `UInput`. Only `UInput` had it, so the first form to reach for a `USelect` would have silently reintroduced the iOS-zoom defect §9.5 already caught once. `h-14` deliberately not applied to `textarea` or `inputTags`, whose height is their content. |
| 2026-09-06 | **New §7.4 — form and container rhythm.** Label→field 4px → **8px**; field content inset 12px → **16px**; stacked field gap 20px → **24px**; field→supporting text 8px → **4px**. Field height (56px), control radius (12px), container radius (16px), card padding (16 / 24px) and heading→card (32px) all measured on-spec and left alone. | Owner reviewed `/login` after the shape fix and reported that the spacing "feels short". §7 could not answer why: §7.1–§7.3 gave the 4dp grid, the layout margins, the pane gap and a table of component *sizes*, and said nothing about the distance between a label and its field, between two stacked fields, or between a heading and the container under it. Every one of those had been chosen by eye. Measured on the running screen, the form carried a 4px label gap (M3's *supporting-text* distance, the tightest space in the field spec, used above the label), a 12px field inset against M3's 16dp, and a 20px field rhythm on a screen whose every other step was 24px. Each replacement is a literal M3 token from the field and dialog sources now listed in §13. An under-specified section that produced a rejected screen is itself the finding. |
| 2026-09-06 | §7.2: the three button-height rows now carry the measured Nuxt UI heights and a pinned `min-h-*` per size. | The rows claimed 32px from `size="sm"` and 40px from `size="md"` / `size="lg"`. Measured against the installed `@nuxt/ui@4.11.0`: `sm` is 28px, `md` 32px, `lg` 36px; only `xl` reaches 40px, and only by taking the label to 16px, above M3's `label-large`. `/login`'s primary action was therefore rendering at **32px** under 56px fields, which is most of what "the spacing feels short" was seeing. This is §9.5's trap in a second component — a size variant is a calibrated bundle of padding *and* font size, applied after the slot, so a height must be stated, not chosen. `min-h-*` rather than `h-*`: a wrapping label under a fixed height is a checklist §6 clipping failure. |
| 2026-09-06 | **§9.4: new ruling — a container sitting directly on the app ground is the Filled card (`UCard variant="soft"` → `bg-emphasized`), never `bg-elevated` and never hand-rolled. Insets inside it step *down* to `bg-default`.** | Found by cross-screen audits on both tracks. Every content container on the three product screens — the permission-denied, not-found, locked, refused, failed and empty panels, and the navigation tree's own list — was hand-rolled at `bg-elevated` and measured `oklch(0.94828)` light / `oklch(0.28448)` dark, byte-identical to the header and footer on the same screen, while the auth card measured one rung up at `oklch(0.91379)` / `oklch(0.34483)`. Same object, same radius, two tones on two screens, and the one that was wrong read as chrome rather than as content. §9.4 had ruled only on cards *inside a pane*; every screen the product has today has no pane, so the case that actually occurs was the case with no rule. The inset corollary is the same argument one level down: `/`'s status block was `bg-emphasized` on what would have become a `bg-emphasized` card, and its idle status chip was already `bg-emphasized` on a `bg-emphasized` block — invisible, shipped, and not caught by a single-screen review. |
| 2026-09-06 | §7.4's 32px heading-block→container and §2.3's chrome-vs-document leading are now carried by a component (`PageHeading.vue`), not by markup on each screen. | The rhythm ruling landed while the heading block existed twice in markup. It was applied to the copy inside `AuthShell` and not to the copy inside `pages/index.vue`, which kept 40px to its container and set its page description in `doc-body` (16/26) with a 16px gap where the auth screens used `body-large` (16/24) with 12px. A ruling written into a document and applied to one of two copies is a ruling that has not landed; the same is now true of the chrome, which moved into `AppShell.vue` for the same reason. |
| 2026-09-07 | **New §5.2 subsection — a state is a layer, never a step to another surface rung.** | `hover:bg-elevated` on a project-authored row is a no-op wherever the row already sits on that rung (measured: oklch(0.94828) over oklch(0.94828) light, oklch(0.28448) over oklch(0.28448) dark, on the tree rows) and reverses direction between themes wherever it is not (measured: a menu row on `bg-accented` going 0.93103 → 0.94828 in light and 0.32759 → 0.28448 in dark). §5.2 gave the mechanism and the opacities but never said in one line that a rung is not a state, so both defects passed a reading of the section that produced them. |
| 2026-09-07 | §3.4: the Controls row's "menus" now explicitly binds project-authored menus. | The editor's mention and slash menus shipped at `rounded-lg` (16px) — the container rung — beside `UDropdownMenu` at `rounded-md`. §3.4 already listed menus under Controls; nothing said the row applies to a menu the project draws itself, and the two menus a user meets most often in edit mode were the only ones off the rung. |
| 2026-09-07 | **New §2.4 subsection — a measure is a cap, not a position, and the content column belongs to the app shell.** `max-w-measure` is now always `mx-auto w-full max-w-measure`, and the three named columns (`measure` / `narrow` / `wide`) are stated once, on the shell. | §2.4 said which token caps the prose column and which token must not, and stopped. It never said that a cap sets no horizontal position, so every screen that followed it correctly rendered a 659px column against the left gutter: measured at 1280×900 in both themes, read, edit and the navigation tree were each **658.9px at x=32**, with 589px of empty page beside them — the right half of a wide screen unused on every product screen. §8.3's "Don't" list did say "then centre", four sections away from where the measure is chosen, and no one implementing §2.4 got there. Compounding it, `AppShell` owned the height and not the width, so all five screens wrote their own `UContainer`, their own column and their own vertical rhythm — the same shape as the drift §4.1 of the checklist exists to catch, in layout rather than in a component. |
| 2026-09-03 | Dark `outline-variant` moved from tone 20 to tone 30; `text-muted` moved to `on-surface-variant` tone 30/80. | At tone 20 the border was invisible on a tone-12 panel. Nuxt UI's default muted text measured 3.9:1 on `bg-muted`, failing the §5 body-text floor. |
| 2026-09-14 | **§9.1 and §9.7: every tonal control (`UButton`/`UBadge` `soft` and `subtle`) carries a 1px inset ring in its accent colour — the `outline` role. Recorded deviation from M3's filled tonal button, which has no outline.** | The cross-screen audit measured `variant="soft"` at **1.02:1** on a `PageNotice`, **1.09:1** on the app bar and **1.00:1** as a diff badge on its own container row: M3's tonal container and §1.4's container rungs share a tone band, so a tonal control on a container is invisible. Fixed once in `app.config.ts` (`TONAL_BOUNDARY`, `tonalFill()`), measured from the tone tables at **≥ 4.47:1** against the fill and **≥ 4.77:1** against every surface, both themes, every alias, and pinned by a browser measurement in `e2e/read.spec.ts`. The shade-step ring `subtle` used to draw measured 1.77:1 / 1.50:1 and is gone; `soft` and `subtle` are now one variant. Commit `d41ae67`. |
| 2026-09-14 | **Three notice tiers, stated once in `apps/web/app/components/InlineNotice.vue`: panel (`PageNotice`, replaces a screen's content), bar (`InlineNotice tier="bar"`, stands in for or beside a form), chip (`InlineNotice tier="chip"`, one line about the thing directly below it, at most one action).** | The audit counted five notice shapes across nineteen hand-rolled copies on the auth, read and edit screens. Edit mode's six save banners and the editor's mention-mismatch line moved to the chip tier; the bar carries an opt-in focus move for a result that replaces the control the user was on. A notice that fits none of the three is a design question, not a fourth `div`. Commit `861afa0`. |
| 2026-09-14 | **Cross-reference: `docs/UI-CHECKLIST.md` §4.11 (Timestamps, added 2026-09-08) binds the treatment of every rendered time.** Viewer's own zone, zone named in the string, ISO 8601 in `<time datetime>`, never server-rendered, tested in two zones. | The page-history screen shipped with a timestamp decision neither document had a rule for; the rule landed in the checklist because it is a correctness matter (a bare local time is ambiguous for a distributed team) and the checklist wins on correctness (§0). This file carries no timestamp type or token of its own: `body-small` in `<time>` is the whole visual treatment, and this row exists so a reader of this file finds the rule that governs it. Applied on `pages/[id]/history.vue`, `books/[id]/history.vue`, `CommentThreadItem.vue`, `PresenceIndicator.vue`. |
| 2026-09-15 | **§8.3 realised: the workspace frame is `UDashboardGroup` (`unit="rem"`) + `UDashboardSidebar` (17.5rem default, 14–28rem, resizable, persisted in a cookie) + `UDashboardPanel` with a `UDashboardNavbar` as the pane's contextual top bar — `AppShell` with a `workspace-id`. §1.4's rungs applied: sidebar and bar `bg-elevated`, content pane `bg-default`, dashboard panels `UCard variant="outline"` inside the pane (§9.4's outlined default). New token `--text-body-medium-emphasized` (14/20/500) per §2.5's "add the ones actually needed". The tree's New… button moved from Filled to Filled tonal.** | The owner rejected the tree-in-a-card screen and the global app bar; the three-pane shell §8.3 named had never been built. The tonal demotion is checklist §2's one-primary-per-view: the tree's toolbar now stands in the sidebar on every screen, beside whatever the screen's own primary is (Save in edit mode), and a Filled button there was a second primary. `body-medium-emphasized` is the author's name on a dashboard row — the lead-in role §2.2 gives Emphasized, at the dense-pane size §9.8 gives a list label. |
| 2026-09-15 | **§8.2/§8.3: focus mode hides the navigation pane entirely from `lg` up — no rail. `WorkspaceSidebar` is `collapsible` at `collapsedSize` 0 with the root hidden while collapsed; the collapse persists in the frame's cookie beside the width; the toggle (`SidebarToggle`) stands in the pane's contextual bar with `Ctrl`/`⌘`+`\`. The comments overlay on the read screen gains the same kind of toggle, its hidden state carrying an M3 numbered badge (`UChip`, §9.7) for the open threads that name the person.** | The owner asked for "a cleaner interaction with the document": the document alone, not M3's 80dp rail (§9.2), which would keep 64px of chrome the person asked to be rid of. A deliberate deviation from the Medium band's "rail or collapsed tree" for the wide bands; below `lg` the drawer is unchanged. Nuxt UI's collapse leaves `min-w-16`, so the root is hidden outright rather than narrowed. |
| 2026-09-16 | **Route-change indicator: Nuxt's `NuxtLoadingIndicator`, mounted once in `app.vue`, drawn in the `primary` role at 3px with `error` for a failed hop, throttled so a hop under 200 ms never shows it, and — under `prefers-reduced-motion` — drawn full from its first frame rather than creeping (`apps/web/app/utils/loading-progress.ts`).** | The owner's 2026-09-16 review asked for an nprogress-style bar; the latency measurement found no screen said a hop was in flight at all. The colour is the `--ui-primary` variable, never a literal, so every theme's own tone renders (checklist §4.2); Nuxt's default green-blue gradient is a brand that is not this one. 3px is Nuxt's default and M3's focus-ring width — no new number. §6.6's global override only shortens the bar's CSS transitions; its growth is JavaScript per frame, so reduced motion has to be honoured in the progress function itself, and the meaning ("in flight") survives as a static full bar (checklist §5, pass/fail). Not a §4.3 shadow case: it is chrome, not a floating surface. |
| 2026-09-15 | Members, the workspaces chooser, book history and diff, edit mode, and page history and diff move onto the workspace frame; `AuthShell` is decoupled from `AppShell`. Edit mode's move closes `docs/UI-CHECKLIST.md`'s 2026-09-07 read/edit 16px column-step follow-up: both modes now stand on the same `bg-default` pane, so the editor's canvas is no longer a rung off the article's. | `docs/TODO.md` Findings, 2026-09-15, has the per-screen detail; `docs/UI-CHECKLIST.md`'s Review Log carries the column-step closure. `AuthShell`'s own composition (a centred Filled card on the app ground, no header/footer landmark, the theme toggle as the one control outside the card) is a direct application of §2.3 (no display type), §2.4 (the column), §9.4 (the card) and §7.4 (the rhythm) rather than a new rule of its own, so it earns a log row for the decoupling, not a new section. |
| 2026-09-16 | **The comment gutter gains a "+" per commentable block and a floating "Comment" beside a text selection; the editor's `@` menu becomes `MentionMenu.vue`, shared with the new `CommentComposer`.** The "+" is `UButton` `ghost` `neutral` at 32px, drawn at `opacity-0` and revealed by hover on its block or by focus (`duration-150 ease-standard`, none under reduced motion); the selection action is a Filled tonal `UButton` (`soft` `primary`, §9.1) at `absolute` coordinates measured against the article's wrapper; the composer is a thread's own card (§9.4's inset, `bg-default` at `rounded-lg` inside the `bg-accented` panel) with §7.4's field rhythm and a Filled Post beside an Outlined Cancel. | The owner could not start a thread from read mode (docs/TODO.md Findings, 2026-09-16). No new token or rung: every value is one the gutter, the thread card and the editor menus already used, which is the point of extracting the menu — §4.1 of the checklist says a second copy is a defect even while identical. The quiet-until-hovered "+" is §4.4 (chrome quieter than content) applied to a control that exists two hundred times on a long page; it is never hidden from the accessibility tree or the tab order (checklist §5), only from the eye. |
| 2026-09-16 | **The editor's block UI: the drop cursor is the `primary` role and the block a drag selects whole is the `secondary-container` pair (`main.css` §13, `.editor-drop-cursor`, `.ProseMirror-selectednode`); the selection toolbar's pressed control is the same `secondary-container` fill (`UButton` `soft` `secondary`) beside `aria-pressed`; the block handle stands in the margin from `md` up and, below it, as a floating chip on the menu rung with `shadow-sm` inside the column; the link popover's URL field is the second `h-10` field standing in chrome (the row below).** | The two ProseMirror-drawn elements carry classes the host cannot put a utility on, so they read the theme's variables from the stylesheet — never a literal (checklist §4.2). `primary` for the drop cursor because at that moment the landing line is the single most important thing on the screen (§1.2); `secondary-container` for the selected block because selected is a semantic role, opaque and identical in both themes, never a state layer (§5.2). The chip below `md` is a transient floating control, the case §4.3 allows a shadow for; it exists only while hovered, dragging or its menu is open. |
| 2026-09-17 | **The source view of edit mode (`EditorSourceSurface`) is set in the code family at the reading surface's metrics — `font-mono text-doc-body`, 16px on 26px — not §2.3's 14px/20px code role; it is a `<textarea>`, not `UTextarea`, with no ring and no box.** | The source view is a text-entry control and §9.5's 16px floor binds every one of them (below it iOS Safari zooms the viewport on focus); the checklist wins on correctness, so the code role's size gives way and the family stays. The line height is the document's, because a page's whole source is read like a page. `UTextarea` is M3's text field — a 56px control with an outline, calibrated for a form — and the source is the document itself, the same object as the contenteditable beside it, so it takes the document's treatment: the measure column, the `-m-4 p-4` reach, the caret in `primary` as its focus indicator (§14, 2026-09-17 above). Below `sm` the view control folds to one icon-only toggle and Save keeps only its icon and fill (label for assistive technology): measured at 320, the segmented control beside Undo, Redo and a labelled Save clipped the "Editing" crumb to "Editi…". |
| 2026-09-17 | **The editing surface's focus indicator is its caret, in the `primary` role (`main.css` §13: `.prosemirror-editor { caret-color: var(--ui-primary) }`, `:focus-visible { outline: none }`), not §5.1's 3px `secondary` ring; the surface draws no radius, ring, border or fill of its own.** | The owner's review of edit mode (2026-09-17): a rounded box hugging the document and fighting the block handle. It was §9's global ring on the contenteditable — a browser treats a text-entry element as `:focus-visible` on any focus, so the ring stood for the whole session — following the surface's `rounded-lg`. A document is not a control among controls; WCAG 2.4.7 counts the text cursor as a text field's focus indicator, and M3's own text field draws its caret in `primary` (`md.comp.outlined-text-field.caret.color`), so the indicator is relocated, never removed (checklist §5), the same move the tree made for its rows. Edit mode is told by its surroundings — the condensed bar with a filled Save, the "Editing" crumb, the handle, the selection toolbar, the caret — never by a box (`PRODUCT.md` principle 6). Measured in `e2e/editor-source.spec.ts`: computed `outline-style: none`, `border-radius: 0px`, caret equal to `--ui-primary`, both themes; the read/edit column geometry unchanged. |
| 2026-09-16 | **A text field standing in chrome — the navigation tree's filter — is `h-10` (40px, the tree row's own height and §7.2's content-area control height), not §9.5's 56px content-area field; its text stays 16px (`size="xl"`, §9.5) and its shape `rounded-md` (§3.4). Stated on the call site's `ui.base`.** (Amended 2026-09-23: it is no longer the only such field — see the row below.) A filter-match highlight is a `<mark>` in the secondary family: `secondary-container`/`on-secondary-container` on an ordinary row, and the accent pair `secondary`/`on-secondary` (`text-inverted`) on the selected row, whose fill is already `secondary-container` — both opaque pairs from §1.2, never the browser's yellow and never an alpha (§12.8). | The 56px field is M3's, calibrated for a form on the document canvas; in a 280px pane between a 32px toolbar and 40px rows it read as a form control that had wandered into the furniture. 40px keeps the field on the pane's own rhythm and above the 24px target floor. The highlight pair was chosen so a match on the selected row — the open page, the common case — is still visible: a `secondary-container` mark on a `secondary-container` row is the §5.2 "same tone painted over itself" failure one level down. |
| 2026-09-17 | **Word-level marks inside an edited diff block (`DiffInlineText.vue`): an insertion is `<ins>` on the `success-container`/`on-success-container` pair, a deletion `<del>` on `error-container`/`on-error-container`, each with the same 1px inset accent ring every tonal chip carries (`ring ring-inset ring-success` / `ring-error`, §9.1/§9.7's `TONAL_BOUNDARY` by hand, since a mark is not a `UBadge`), `box-decoration-clone` across wrapped lines, `rounded-xs` (`corner-extra-small`), and the browser's own underline and strike kept as the second signal. M3's `tertiary-container` role (§1.2) is carried here by the `success` alias, not by a seventh Nuxt UI alias.** The diff screens' "Unified \| Side by side" control (`DiffLayoutControl.vue`) is M3's segmented button: a `UFieldGroup` of Outlined `neutral` segments with the selected one on `secondary-container` (`soft` `secondary`) beside `aria-pressed`. | The owner's review of gates 10.4/10.6 asked for "a diff like GitHub's" and named `tertiary-container`/`error-container` with 3:1 boundaries, never raw red/green. This project has no `tertiary` alias: Nuxt UI's closed set is primary/secondary/success/info/warning/error/neutral, and `success` is the alias that already names "Added" on the block badge beside the marks — one hue for one meaning, and no new palette to author and measure. The ring is what the 2026-09-14 audit taught: a container pair on the `bg-default` row measures fine as text, but its *edge* is what §5's 3:1 rule is about. `e2e/diff.spec.ts` measures each mark's boundary in the browser: **6.19:1** (`<ins>`) and **7.08:1** (`<del>`) in light, **12.13:1** and **11.46:1** in dark. The segmented control's selected fill is the selected role (§5.2), never a state layer. |
| 2026-09-17 | **New §4.5 — the stacking order.** Modals take `z-60` (scrim and content, `app.config.ts`); `ConfirmDialog` takes `z-70`; everything the library floats stays at `auto`; toasts keep the library's `z-[100]`. | Measured at 320×900 (`docs/UI-CHECKLIST.md` Review Log, 2026-09-16, "Integration regressions"): the sidebar drawer stacked above "Leave without saving?" when a row in the drawer was clicked with a dirty editor — two Reka dialogs at `z-index: auto`, the later portal on top, a pointer unable to reach Cancel. §4 gave every floating surface a tone and a shadow and no order; M3's own order (drawer level 4 above dialog level 3) is the one that failed. The owner ruled the confirm dialog outranks every overlay; the ladder is written down so the next overlay is placed, not fought over. `e2e/editor.spec.ts` measures `elementFromPoint` at Cancel with the drawer open behind. |
| 2026-09-23 | **The page's title field (`PageTitle.vue`) is the third text surface that takes the document's treatment rather than §9.5's: a plain `<input>` inside the `<h1>`, at that heading's own type role (`headline-medium`), with no ring, no fill and no 56px rhythm — the caret in `primary` is its focus indicator (`main.css` §13, `.dw-title-editor`).** | The owner asked for the title to be edited where the page is read, "como en obsidian" (2026-09-23). §9.5's field is M3's, calibrated for a form; a page's title is the document's own name, the same object as the prose under it, and the reviewed precedent for exactly that is the source view's text area (the 2026-09-17 row below: "a document is not a control among controls"). The heading's role is kept *in* the field so the title does not change size when it becomes editable — checklist §3's "no layout shift", the same argument that put the tree's row editor at the row's own 40px. It stands inside the `<h1>` rather than replacing it so the screen keeps exactly one heading in every state (checklist §4.4), and it carries its own accessible name, because a heading is not a label. 16px is not at risk here: `headline-medium` is 28px, well above §9.5's iOS-zoom floor. |
| 2026-09-23 | **The toast is the product's fourth notice surface, and the only one that removes itself: `UToast` through `useStatusToast()`, on `bg-accented` like every other overlay (§9.6), with the library's `shadow-lg` and `rounded-lg`, the sentence at M3's snackbar supporting-text role (`body-medium`), at most one action, capped at three at a time in `app.vue`. A deviation from §9.6's `inverse-surface` snackbar, recorded here rather than taken quietly.** | The owner, pointing at the green "Saved “parla”." bar under a page title: "estas cosas pueden manejarse como toasts". §9.6 gives a snackbar `inverse-surface` "because they are rare and must be noticed" — and once every save, every creation and every invitation is confirmed this way they are not rare, and a surface that must be noticed is the wrong shape for a confirmation of something that already worked. Two measurable reasons beside the argument: M3 pairs a snackbar's action label with `inverse-primary`, a role this stack has no alias for (the same gap §9.7 records for `tertiary`), and the icon that carries the tone as a second signal (checklist §5) is an accent colour with no guarantee on an inverted ground. `bg-accented` is where §9.6 already sent the menus, the dialogs and the popovers, so a toast is one more floating surface rather than a seventh answer. Where it stands is §4.5's top rung, `z-[100]`, which the library already had. The rule for *which* tier a message takes is a correctness matter and lives in `docs/UI-CHECKLIST.md` §4.12; the shapes are stated in `InlineNotice.vue`. |
| 2026-09-23 | **The navigation tree's inline row editor — the field a node is created or renamed in (`NavigationTreeRowEditor.vue`) — takes the same 40px chrome metric as the tree's filter: `h-10` on `ui.base`, 16px text (`size="xl"`, §9.5), `rounded-md` (§3.4). The row above's "the one such field the product has" is amended accordingly: there are two, and the metric is the rule rather than the exception.** A refusal the person can fix by typing stands *under* the field as an `error-container`/`on-error-container` chip at `rounded-md`, wired to the field with `aria-describedby`; the row grows to hold it. | The owner rejected the tree's create and rename dialogs (`docs/UI-CHECKLIST.md` Review Log, 2026-09-23) and asked for VS Code's input-box-in-the-row. 40px is not a new number: it is the tree row's own height (§7.2), so the row does not change height when its label becomes a field and nothing above or below it moves — checklist §3's "no layout shift", measured as the same rule that put the filter box at 40px in a 280px pane rather than at §9.5's 56px. The error goes under the field and not beside it because 280px of pane has no room beside a field, and a truncated reason is not a reason (the same finding as the context menu's wrapped item descriptions, 2026-09-16). No new colour, token or rung: `error-container` is the pair every refusal in the product already uses. |
