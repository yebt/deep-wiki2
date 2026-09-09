import { describe, expect, test } from 'bun:test';
import { LEGAL_PARENT_TYPES as CORE_TABLE, NODE_TYPES } from '@deep-wiki/core';
import {
  CreateNodeRequestSchema,
  CreateNodeResponseSchema,
  LEGAL_PARENT_TYPES,
  legalChildTypes,
  NODE_TITLE_MAX_LENGTH,
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

  test('a create request needs a parent, a type and a non-empty title', () => {
    const parsed = CreateNodeRequestSchema.safeParse({ parentId: 'n1', type: 'page', title: '  Setup  ' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.title).toBe('Setup');

    expect(CreateNodeRequestSchema.safeParse({ parentId: 'n1', type: 'page', title: '   ' }).success).toBe(false);
    expect(CreateNodeRequestSchema.safeParse({ parentId: '', type: 'page', title: 'x' }).success).toBe(false);
    expect(CreateNodeRequestSchema.safeParse({ parentId: 'n1', type: 'folder', title: 'x' }).success).toBe(false);
    expect(
      CreateNodeRequestSchema.safeParse({ parentId: 'n1', type: 'page', title: 'a'.repeat(NODE_TITLE_MAX_LENGTH + 1) }).success,
    ).toBe(false);
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

  test('a rename request carries only the new title', () => {
    expect(RenameNodeRequestSchema.safeParse({ title: 'Renamed' }).success).toBe(true);
    expect(RenameNodeRequestSchema.safeParse({ title: '' }).success).toBe(false);
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
});
