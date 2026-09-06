import { Schema } from 'prosemirror-model';
import { expect, test } from 'bun:test';
import { classify } from './classify';
import { schema } from './schema';

// design.md D5 — "classify() derives its verdict from the schema; ... moving
// a node's schema membership must move which fixture directory it belongs
// in." A fake tree with a `paragraph` and a `heading` node is enough to
// exercise the derivation without needing the real markdown parser here.

function tree(children: Array<{ type: string }>) {
  return { type: 'root', children } as never;
}

test('a tree using only nodes the schema names classifies as modelled', () => {
  const result = classify(tree([{ type: 'paragraph' }, { type: 'heading' }]), schema);

  expect(result).toEqual({ bucket: 'modelled' });
});

test('a tree containing a verbatim-carried node type classifies as verbatim, naming the type', () => {
  const result = classify(tree([{ type: 'paragraph' }, { type: 'html' }]), schema);

  expect(result).toEqual({ bucket: 'verbatim', carriedType: 'html' });
});

test('a tree containing a node type the schema does not name at all is refused', () => {
  const result = classify(tree([{ type: 'someFutureConstruct' }]), schema);

  expect(result).toMatchObject({ bucket: 'refused', nodeType: 'someFutureConstruct' });
});

test('moving a node out of the schema moves its fixture from modelled to refused', () => {
  const { paragraph: _removed, ...restNodes } = schema.spec.nodes.toObject() as Record<string, unknown>;
  const reducedSchema = new Schema({
    nodes: restNodes as never,
    marks: schema.spec.marks.toObject() as never,
  });

  const withRealSchema = classify(tree([{ type: 'paragraph' }]), schema);
  const withReducedSchema = classify(tree([{ type: 'paragraph' }]), reducedSchema);

  expect(withRealSchema.bucket).toBe('modelled');
  expect(withReducedSchema.bucket).toBe('refused');
});

test('marks (emphasis, strong) count as named by the schema, not only nodes', () => {
  const result = classify(tree([{ type: 'paragraph' }, { type: 'emphasis' }, { type: 'strong' }]), schema);

  expect(result).toEqual({ bucket: 'modelled' });
});
