export type NodeType = 'workspace' | 'shelf' | 'book' | 'chapter' | 'page';

export const LEGAL_PARENT_TYPES: Record<NodeType, readonly NodeType[]> = {
  workspace: [],
  shelf: ['workspace'],
  book: ['shelf'],
  chapter: ['book'],
  page: ['book', 'chapter'],
};
