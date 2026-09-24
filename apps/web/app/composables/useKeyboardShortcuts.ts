/**
 * One list of keys, rendered twice — as a surface a person can read, and
 * as a sentence assistive technology is given.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 *
 * docs/UI-CHECKLIST.md §5 requires a pointer-only manipulation's keyboard
 * equivalent to be **named in the UI**, not only in a comment. The
 * navigation tree answered that with a `?` control carrying a tooltip and
 * an `sr-only` paragraph of prose — and the owner reported on 2026-09-23
 * that the `?` did nothing when clicked, which was exactly true: it was a
 * `UButton` inside a `UTooltip` with no `@click` and no action, which §6
 * counts as observable breakage ("every control that looks clickable does
 * something").
 *
 * Making it open a real surface means the keys are written down twice — a
 * list for the eye and a sentence for a screen reader — and two copies of
 * the same facts is the defect §4.1 names. So the sentence is *derived*
 * from the list: `spoken` is how a key chord is said out loud ("Alt with
 * the arrow keys"), `keys` is how it is drawn (`Alt` `↑` `↓`), and
 * `description` is one verb phrase that reads correctly after either.
 *
 * Edit mode has no shortcut surface at all and was flagged for one in the
 * same review (docs/UI-CHECKLIST.md Review Log, 2026-09-23, "the general
 * gap remains owed"). This type and `KeyboardShortcutsHelp.vue` are what
 * it will need; its own list is recorded as owed in docs/TODO.md rather
 * than invented here, because naming a binding this file cannot see is
 * how a second, wrong list gets written.
 */

export interface KeyboardShortcut {
  /**
   * The chord as it is drawn, one `UKbd` per entry. Arrow glyphs belong
   * here and never in `spoken`, where a screen reader would either skip
   * them or read them as punctuation.
   */
  readonly keys: readonly string[];
  /** The same chord said out loud — the subject of the derived sentence. */
  readonly spoken: string;
  /** One verb phrase, in the third person, that follows either spelling: "move through the tree". */
  readonly description: string;
}

/**
 * The list as one sentence: `<spoken> <description>`, joined with
 * semicolons and closed with a full stop. Semicolons rather than full
 * stops between the clauses because a screen reader pauses at both and
 * only one of them is a sentence boundary.
 */
export function shortcutsSentence(shortcuts: readonly KeyboardShortcut[]): string {
  if (shortcuts.length === 0) return '';
  return `${shortcuts.map((shortcut) => `${shortcut.spoken} ${shortcut.description}`).join('; ')}.`;
}
