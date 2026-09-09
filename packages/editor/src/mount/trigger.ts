/**
 * Pure trigger-detection logic shared by the `@` mention and `/` slash
 * command plugins (document-editor spec: "Mention And Slash Menus Are
 * Keyboard-First", "No Menu Inside A Code Block"). No DOM, no
 * `EditorView` — testable directly against a string and an `EditorState`.
 */
import type { EditorState } from 'prosemirror-state';

export interface TriggerMatch {
  /** Document position of the trigger character itself. */
  readonly from: number;
  /** Text typed after the trigger character, up to the cursor. */
  readonly query: string;
}

/**
 * `textBefore` is the plain text of the current text block up to the
 * cursor. The trigger character must sit at the start of a "word" — start
 * of line or preceded by whitespace — and the query run after it must
 * contain no whitespace, so `email@example` never opens a mention menu
 * mid-address and a completed `@name other words` closes it once the
 * user moves on.
 */
export function matchTrigger(textBefore: string, triggerChar: string): TriggerMatch | null {
  const escaped = triggerChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|\\s)${escaped}([^\\s${escaped}]*)$`);
  const match = pattern.exec(textBefore);
  if (!match) return null;

  const query = match[1] ?? '';
  const from = textBefore.length - query.length - 1;
  return { from, query };
}

/** True while the cursor sits inside a `code` (fenced block) node — both menus are inert there. */
export function isInsideCodeBlock(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.spec.code) return true;
  }
  return false;
}
