/**
 * The keys the read layer (`useApiRead`) files each answer under, in one
 * place so a write can name what it stales. A key is the request's
 * identity: the route and every parameter that changes the answer.
 */

export function pageReadKey(nodeId: string): string {
  return `page:${nodeId}`;
}

/** Where a node lives — its workspace by id and slug. Never staled: a node's workspace does not change. */
export function nodeLocationKey(nodeId: string): string {
  return `node-location:${nodeId}`;
}

export function pageHistoryKey(nodeId: string): string {
  return `page-history:${nodeId}`;
}

export function pageDiffKey(nodeId: string, from: string, to: string): string {
  return `page-diff:${nodeId}:${from}:${to}`;
}

export function bookHistoryKey(bookId: string): string {
  return `book-history:${bookId}`;
}

export function bookDiffKey(bookId: string, since: string): string {
  return `book-diff:${bookId}:${since}`;
}

export function workspaceActivityKey(workspaceId: string): string {
  return `workspace-activity:${workspaceId}`;
}

export function workspaceMembersKey(workspaceId: string): string {
  return `workspace-members:${workspaceId}`;
}

/**
 * What a saved page stales, as a predicate for `clearNuxtData`: the page's
 * own read and history, and every book history, book diff and workspace
 * activity — a save is a new revision, and which book and workspace it
 * lands in is not something the save response says. A page diff between
 * two named revisions never changes and is kept.
 */
export function keysStaledBySave(nodeId: string): (key: string) => boolean {
  const own = new Set([pageReadKey(nodeId), pageHistoryKey(nodeId)]);
  return (key) => own.has(key) || key.startsWith('book-history:') || key.startsWith('book-diff:') || key.startsWith('workspace-activity:');
}

/**
 * What a renamed node stales **on other screens**: every workspace
 * activity list, whose rows name the pages they are about and whose
 * workspace a rename does not name. Not its history or its diffs, which
 * name revisions rather than titles; not the tree, which is patched in
 * place from the rename's own answer (`useWorkspaceTree.applyRenamed`).
 *
 * And deliberately **not the renamed node's own read**, although that
 * response carries the title. A rename is most often made from the screen
 * rendering exactly that key, and clearing a key a mounted screen reads
 * empties it: `useApiRead`'s outcome goes `null`, `useReadStatus` answers
 * `idle`, and the article is replaced by its own loading skeleton. That
 * one is *refreshed* in place instead — the answer stays on screen while
 * the request is in flight — which is what `PageTitle` does beside this.
 */
export function keysStaledByRename(): (key: string) => boolean {
  return (key) => key.startsWith('workspace-activity:');
}
