// "the client needs the table too" — the exact copy that lands here.
const LEGAL_PARENT_TYPES: Record<string, readonly string[]> = {
  workspace: [],
  shelf: ['workspace'],
  book: ['shelf'],
  chapter: ['book'],
  page: ['book', 'chapter'],
};

export const legal = LEGAL_PARENT_TYPES;
