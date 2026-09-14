// Nested three directories deep in apps/web, where a non-recursive scan of
// one directory in packages/db can never reach it.
export type NodeType = 'workspace' | 'shelf' | 'book' | 'chapter' | 'page';
