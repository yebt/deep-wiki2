interface RevisionRow {
  readonly content: string;
  readonly block_index: readonly { readonly id: string }[];
}

export function loadAnchors(revision: RevisionRow): readonly { readonly id: string }[] {
  return revision.block_index;
}
