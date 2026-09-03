export default defineAppConfig({
  ui: {
    // Nuxt UI's default color aliases. Deliberately left at the library
    // defaults for Phase 0 — theme authoring (docs/SPECS.md §11.2,
    // workspace-default + per-user override) is out of scope for the
    // smoke page. Both `light` and `dark` color modes are exercised via
    // `UColorModeButton` below, proving the CSS-variable token pipeline
    // works before any custom theme is authored.
    colors: {
      primary: 'blue',
      neutral: 'slate',
    },
  },
});
