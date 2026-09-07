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

  test('pipeline.ts, the sole owner, may construct the shared processor', () => {
    expect(
      checkFile('packages/markdown/src/pipeline.ts', "import remarkParse from 'remark-parse';"),
    ).toEqual([]);
  });

  test('packages/editor may reach for prosemirror-markdown — it owns the ProseMirror side of the round trip', () => {
    expect(checkFile('packages/editor/src/schema.ts', "import { x } from 'prosemirror-markdown';")).toEqual([]);
  });

  // Closes the exact gap render.ts fell through: PARSER_OWNERS above governs
  // who may import the raw remark/unified building blocks at all, not
  // whether a second, divergent processor is built with them once inside.
  // A file other than pipeline.ts constructing its own `remark-parse`-based
  // processor is a second parser, even though it lives inside an allowed
  // owner directory.
  test('a second remark-parse pipeline elsewhere inside packages/markdown fails, even though the directory is an allowed owner', () => {
    const errors = checkFile(
      'packages/markdown/src/render.ts',
      "import remarkParse from 'remark-parse';\nconst p = unified().use(remarkParse);",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('pipeline.ts');
  });

  test('a second remark-stringify pipeline elsewhere inside packages/editor fails too — PARSER_OWNERS is not a blanket exemption', () => {
    const errors = checkFile(
      'packages/editor/src/rogue-serializer.ts',
      "import remarkStringify from 'remark-stringify';",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('pipeline.ts');
  });

  // A `.test.ts` file legitimately builds a throwaway, deliberately "naive"
  // comparison pipeline to prove what a missing pin or an unmodelled schema
  // node would produce (see round-trip.test.ts, canonical.test.ts) — the
  // same "describing the forbidden pattern" exemption `isSelfReferential`
  // already grants this check's own test file.
  test('a test file may still build a throwaway comparison pipeline to prove a regression', () => {
    expect(
      checkFile('packages/markdown/src/canonical.test.ts', "import remarkStringify from 'remark-stringify';"),
    ).toEqual([]);
  });

  test('a stray Milkdown import outside packages/editor fails', () => {
    const errors = checkFile('apps/web/app/pages/edit.vue', "import { Editor } from '@milkdown/core';");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@milkdown/');
  });

  test('packages/editor may import Milkdown — it owns the ProseMirror side', () => {
    expect(checkFile('packages/editor/src/editor.ts', "import { Editor } from '@milkdown/core';")).toEqual([]);
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

  // bundle-isolation.ts shares the same self-referential problem — it also
  // compares against milkdown/@milkdown//@tiptap/ literals to describe the
  // exact specifiers its own denylist forbids.
  test('the check also excludes bundle-isolation.ts and its test', () => {
    expect(isSelfReferential('scripts/checks/bundle-isolation.ts')).toBe(true);
    expect(isSelfReferential('scripts/checks/__tests__/bundle-isolation.test.ts')).toBe(true);
  });
});
