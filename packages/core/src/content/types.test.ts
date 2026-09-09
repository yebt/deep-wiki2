import { expect, test } from 'bun:test';
import type { BlockStatus, PageContent, PageContentRef, PersistedBlock } from './types';

// design.md "Where the pure logic lives" — packages/core holds content
// entity types built from primitives (BlockId, BlockStatus,
// PageContentRef); no mdast type, no unified/remark import, ever (D19).

test('a PageContentRef is a plain pair of node and workspace identity', () => {
  const ref: PageContentRef = { nodeId: 'node-1', workspaceId: 'ws-1' };

  expect(ref.nodeId).toBe('node-1');
  expect(ref.workspaceId).toBe('ws-1');
});

test('every BlockStatus value is one of the three lifecycle states', () => {
  const statuses: BlockStatus[] = ['active', 'superseded', 'tombstoned'];

  expect(statuses).toHaveLength(3);
});

test('a superseded PersistedBlock names its survivor', () => {
  const block: PersistedBlock = {
    id: 'abc123',
    status: 'superseded',
    supersededBy: 'def456',
    contentHash: 'hash',
    excerpt: 'some text',
  };

  expect(block.status).toBe('superseded');
  expect(block.supersededBy).toBe('def456');
});

test('PageContent is a primitive-typed shape, holding markdown as a plain string', () => {
  const content: PageContent = {
    markdown: '# Hello\n',
    renderedHtml: '<h1>Hello</h1>',
    blockIndex: {},
    contentHash: 'hash',
    pipelineVersion: 1,
  };

  expect(typeof content.markdown).toBe('string');
  expect(typeof content.renderedHtml).toBe('string');
});
