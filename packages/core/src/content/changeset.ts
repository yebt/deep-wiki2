/**
 * Book-scoped, implicit grouping of page revisions by the same author
 * inside a time window (versioning-and-collaboration changesets spec).
 * `closedAt` records when activity stopped, on retirement only — it is
 * never a second copy of `CHANGESET_WINDOW_MINUTES`; whether it falls
 * inside the window is computed at read time from that one constant.
 */
export interface Changeset {
  readonly id: string;
  readonly workspaceId: string;
  readonly bookId: string;
  readonly authorId: string;
  readonly message: string | null;
  readonly lastActivityAt: string;
  readonly closedAt: string | null;
}
