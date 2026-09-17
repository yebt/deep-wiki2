import { describe, expect, test } from 'bun:test';
import { LEGAL_PARENT_TYPES as CORE_TABLE, NODE_TYPES } from '@deep-wiki/core';
import {
  CreateNodeRequestSchema,
  CreateNodeResponseSchema,
  LEGAL_PARENT_TYPES,
  legalChildTypes,
  NODE_TITLE_MAX_LENGTH,
  NodeLocationResponseSchema,
  NodeTypeSchema,
  RenameNodeRequestSchema,
} from './nodes';

describe('node contracts', () => {
  /**
   * The whole reason this module re-exports rather than restates. If a
   * later edit types the table out again, this is what fails: the client
   * menu and the server rule would otherwise drift silently.
   */
  test('the hierarchy re-export is core’s table itself, not a copy', () => {
    expect(LEGAL_PARENT_TYPES).toBe(CORE_TABLE);
    expect(legalChildTypes('book')).toEqual(['chapter', 'page']);
  });

  test('the node-type enum is built from core’s list, not restated', () => {
    expect([...NodeTypeSchema.options]).toEqual([...NODE_TYPES]);
  });

  /**
   * Each refusal below names a different rule, so each is read back by the
   * field and the rule that produced it. `success === false` alone would be
   * satisfied by a schema that refused every one of these bodies for the
   * same, or for no particular, reason.
   */
  function refusalsFor(input: unknown): { path: readonly (string | number)[]; code: string }[] {
    const result = CreateNodeRequestSchema.safeParse(input);

    expect(result.success).toBe(false);
    if (result.success) return [];

    return result.error.issues.map((issue) => ({ path: [...issue.path], code: issue.code }));
  }

  test('a create request needs a parent, a type and a non-empty title', () => {
    const parsed = CreateNodeRequestSchema.safeParse({ parentId: 'n1', type: 'page', title: '  Setup  ' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.title).toBe('Setup');

    expect(refusalsFor({ parentId: 'n1', type: 'page', title: '   ' })).toEqual([
      { path: ['title'], code: 'too_small' },
    ]);
    expect(refusalsFor({ parentId: '', type: 'page', title: 'x' })).toEqual([
      { path: ['parentId'], code: 'too_small' },
    ]);
    expect(refusalsFor({ parentId: 'n1', type: 'folder', title: 'x' })).toEqual([
      { path: ['type'], code: 'invalid_enum_value' },
    ]);
    expect(refusalsFor({ parentId: 'n1', type: 'page', title: 'a'.repeat(NODE_TITLE_MAX_LENGTH + 1) })).toEqual([
      { path: ['title'], code: 'too_big' },
    ]);
  });

  /**
   * `workspace` passes the shape check on purpose: whether a type is
   * legal depends on the parent, and encoding a partial answer in the
   * enum would be the second copy of the table this module exists to
   * avoid. The route refuses it through `LEGAL_PARENT_TYPES`.
   */
  test('the shape check does not pre-judge legality', () => {
    expect(CreateNodeRequestSchema.safeParse({ parentId: 'n1', type: 'workspace', title: 'x' }).success).toBe(true);
    expect(LEGAL_PARENT_TYPES.workspace).toEqual([]);
  });

  test('a rename request carries only the new title, trimmed, and refuses an empty one', () => {
    expect(RenameNodeRequestSchema.parse({ title: '  Renamed  ', id: 'n2' })).toEqual({ title: 'Renamed' });

    const result = RenameNodeRequestSchema.safeParse({ title: '' });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['title']]);
  });

  test('the create response carries what the client needs to render the new row', () => {
    const parsed = CreateNodeResponseSchema.safeParse({
      id: 'n2',
      parentId: 'n1',
      type: 'page',
      slug: 'setup',
      title: 'Setup',
      position: 3,
    });
    expect(parsed.success).toBe(true);
  });

  /**
   * `GET /nodes/:id/location` answers "which workspace does this node
   * live in", by both keys a URL can carry — the id the API is keyed by
   * and the slug the address bar shows (`/w/<slug>/p/<id>`).
   */
  test('the location response names the node, its type and its workspace by id and by slug', () => {
    const parsed = NodeLocationResponseSchema.parse({
      id: 'node-1',
      type: 'page',
      workspaceId: 'ws-1',
      workspaceSlug: 'acme',
      extra: 'stripped',
    });
    expect(parsed).toEqual({ id: 'node-1', type: 'page', workspaceId: 'ws-1', workspaceSlug: 'acme' });
    expect(NodeLocationResponseSchema.safeParse({ id: 'node-1', type: 'page', workspaceId: 'ws-1' }).success).toBe(false);
    expect(NodeLocationResponseSchema.safeParse({ id: 'node-1', type: 'folder', workspaceId: 'ws-1', workspaceSlug: 'acme' }).success).toBe(false);
  });
});
