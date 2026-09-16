/**
 * The `@` trigger for a plain textarea — the comment composer's half of
 * what `packages/editor/src/mount/trigger.ts` does inside ProseMirror.
 * Pure string functions, so the composer's keyboard behaviour is tested
 * without a DOM and the editor's own trigger is not pulled into the read
 * path (`scripts/checks/bundle-isolation.ts`).
 */

export interface MentionQuery {
  /** Offset of the `@`. */
  readonly from: number;
  /** The caret — the query runs from `from + 1` to here. */
  readonly to: number;
  readonly query: string;
}

export interface ConfirmedMention {
  readonly id: string;
  readonly label: string;
}

/** The open `@query` the caret sits at the end of, or `null`: an `@` at the start or after whitespace, followed by no whitespace and no second `@`. */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  const before = text.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/.exec(before);
  if (!match) return null;
  const from = caret - match[1]!.length - 1;
  return { from, to: caret, query: match[1]! };
}

/** Replaces the query with `@label ` and reports where the caret lands. */
export function insertMention(text: string, range: { from: number; to: number }, label: string): { text: string; caret: number } {
  const inserted = `@${label} `;
  return { text: `${text.slice(0, range.from)}${inserted}${text.slice(range.to)}`, caret: range.from + inserted.length };
}

/**
 * The user ids to send with a comment: the mentions confirmed from the
 * menu whose `@label` still stands in the text — a mention the person
 * typed and then deleted notifies nobody. Explicit ids only, never parsed
 * out of free text (`CreateCommentRequestSchema.mentionedUserIds`).
 */
export function mentionedIdsIn(text: string, confirmed: readonly ConfirmedMention[]): string[] {
  const ids: string[] = [];
  for (const mention of confirmed) {
    if (!ids.includes(mention.id) && text.includes(`@${mention.label}`)) ids.push(mention.id);
  }
  return ids;
}
