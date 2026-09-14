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

  // ── The four evasions an audit proved by construction ────────────────
  //
  // Every one of these was run against the check before the fix and PASSED.

  // `remark` is not a parser-adjacent helper; the meta-package *is*
  // `unified().use(remarkParse).use(remarkStringify)`. One import is a
  // complete second pipeline, and the denylist named only its two halves.
  test('the `remark` meta-package is a whole second pipeline in one import', () => {
    const errors = checkFile('apps/web/app/pages/x.vue', "import { remark } from 'remark';");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('remark');
  });

  // Both are installed in this repository today (mdast-util-to-markdown as a
  // direct dependency of packages/markdown, mdast-util-from-markdown
  // transitively, hoisted and importable). Together they are a full
  // markdown round trip carrying none of the shared pipeline's GFM,
  // frontmatter, wiki-link, tag or block-anchor extensions — the exact
  // divergence GATE-2 exists to pin down.
  test('mdast-util-from-markdown/to-markdown outside an owner are a full round trip with none of the extensions', () => {
    const errors = checkFile(
      'apps/api/src/render.ts',
      "import { fromMarkdown } from 'mdast-util-from-markdown';\nimport { toMarkdown } from 'mdast-util-to-markdown';",
    );

    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('mdast-util-from-markdown'))).toBe(true);
    expect(errors.some((e) => e.includes('mdast-util-to-markdown'))).toBe(true);
  });

  // packages/markdown's own extension handlers legitimately build on
  // mdast-util-to-markdown's `defaultHandlers`: they ARE the shared
  // pipeline's serialiser extensions, not a second one.
  test('packages/markdown may still build its own serialiser extensions on mdast-util-to-markdown', () => {
    expect(
      checkFile(
        'packages/markdown/src/extensions/list-marker.ts',
        "import { defaultHandlers, type Handle } from 'mdast-util-to-markdown';",
      ),
    ).toEqual([]);
  });

  // The denylist compared against `'x` and `"x` only, so the third quote
  // character JavaScript has walked straight past it.
  test('a backtick-quoted dynamic import is an import too', () => {
    const errors = checkFile('apps/web/app/pages/edit.vue', 'const e = await import(`@milkdown/core`);');

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('@milkdown/');
  });

  // Reversed deliberately. `prosemirror-markdown` ships
  // `defaultMarkdownParser` and `defaultMarkdownSerializer` — a complete
  // second markdown parser — and it was blessed inside packages/editor, the
  // one package whose entire job is markdown<->ProseMirror conversion, with
  // no justification written down anywhere. Unlike the `prosemirror-model`
  // exemption in bundle-isolation.ts, which carries its reasoning and a
  // reversal condition, this one carried nothing. packages/editor does not
  // depend on it (see its package.json) and converts through
  // packages/markdown's mdast instead, so the blessing was not paying for
  // anything either.
  test('prosemirror-markdown is forbidden even inside packages/editor — it ships a complete second parser', () => {
    const errors = checkFile(
      'packages/editor/src/schema.ts',
      "import { defaultMarkdownParser } from 'prosemirror-markdown';",
    );

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('prosemirror-markdown');
  });

  // Naming it in prose is how the reasoning above gets written down at all.
  test('naming prosemirror-markdown in a doc comment is not importing it', () => {
    expect(
      checkFile('packages/editor/src/schema.ts', '// `prosemirror-markdown` has for the identical reason.'),
    ).toEqual([]);
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
