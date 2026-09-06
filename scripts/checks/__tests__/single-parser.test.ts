import { describe, expect, test } from 'bun:test';
import { checkFile, isSelfReferential } from '../single-parser';

describe('checkFile', () => {
  test('an app importing a second markdown parser fails', () => {
    const errors = checkFile('apps/web/app/pages/x.vue', "import MarkdownIt from 'markdown-it';");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('markdown-it');
  });

  test("using @nuxt/ui's TipTap editor surface fails, because it ships its own serialiser", () => {
    const errors = checkFile('apps/web/app/pages/edit.vue', '<UEditor v-model="doc" />');
    expect(errors[0]).toContain('second parser');
  });

  test('the composable is caught too, not just the component', () => {
    expect(checkFile('apps/web/x.ts', 'const m = useEditorMenu();')).toHaveLength(1);
  });

  test('packages/markdown may reach for the pipeline it owns', () => {
    expect(checkFile('packages/markdown/src/index.ts', "import remarkParse from 'remark-parse';")).toEqual([]);
  });

  test('packages/editor may too — it owns the ProseMirror side of the round trip', () => {
    expect(checkFile('packages/editor/src/schema.ts', "import { x } from 'prosemirror-markdown';")).toEqual([]);
  });

  test('ordinary code with no parser import passes', () => {
    expect(checkFile('apps/api/src/routes/auth.ts', "import { Hono } from 'hono';")).toEqual([]);
  });
});

describe('isSelfReferential', () => {
  // A check that describes forbidden patterns contains them; query-boundaries.ts
  // hit this first and the exclusion is the documented remedy.
  test('the check excludes its own source and tests', () => {
    expect(isSelfReferential('scripts/checks/single-parser.ts')).toBe(true);
    expect(isSelfReferential('scripts/checks/__tests__/single-parser.test.ts')).toBe(true);
    expect(isSelfReferential('apps/web/app/pages/edit.vue')).toBe(false);
  });
});
