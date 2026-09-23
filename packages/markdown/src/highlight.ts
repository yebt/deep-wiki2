/**
 * Syntax highlighting for fenced code blocks, applied **at render time, on
 * the server**, inside this package's own pipeline.
 *
 * Where this runs is the whole design. Read mode serves the cached,
 * sanitised `page_content.rendered_html` and boots no editor code
 * (docs/SPECS.md §5.3; `scripts/checks/bundle-isolation.ts` enforces the
 * editor half), so a highlighter that ran in the browser would be a second,
 * client-side pass over content the server already rendered — megabytes of
 * grammars and a WebAssembly regex engine on the read path, for a result
 * the save could have baked in. It therefore runs here, `render()` stores
 * the result, and `CURRENT_PIPELINE_VERSION` + `backfillStaleRenders` carry
 * it to the corpus that was cached before it shipped.
 *
 * ## Why Shiki, pinned
 *
 * `shiki@4.4.3`, exact. It is a *highlighter*, not a markdown parser, so
 * `scripts/checks/single-parser.ts` has nothing to say about it — its
 * denylist names markdown parsers and serialisers, `shiki`/`@shikijs/*`
 * appear in none of them, and this file lives inside `packages/markdown/`,
 * a `PARSER_OWNERS` entry, in any case. What made it the choice over
 * `highlight.js` or `prismjs`:
 *
 * - **It tokenises with the real TextMate grammars VS Code uses**, so the
 *   result matches what the authors of this content see in their editor.
 * - **Its `cssVariables` theme emits a closed, named token vocabulary**
 *   rather than baked hex colours. That is what lets this file translate
 *   each token into one `hl-*` class and hand the *colour* decision to
 *   `main.css`, which means a light/dark switch is a stylesheet change and
 *   **never a re-render of every page**. Shiki's dual-theme output would
 *   have put `style="color:#…;--shiki-dark:#…"` on every token span — a
 *   theme baked into ten thousand cached pages, and an inline-`style`
 *   allowance in the sanitiser, for no gain.
 *
 * ## Why a tokenisation time limit would have made the cache nondeterministic
 *
 * `rendered_html` is a **cache**: the same Markdown must render to the same
 * bytes on the save that wrote it and on the backfill that later re-renders
 * it, or the two disagree for no reason a reader could ever explain.
 *
 * Shiki inherits VS Code's `tokenizeTimeLimit`, **500 ms per line by
 * default**, and `vscode-textmate` honours it by giving up mid-line and
 * emitting the remainder as one undifferentiated token. A grammar's first
 * line pays for compiling its rules, which on this host regularly crosses
 * that budget — so the first fence a process highlighted came out coarse
 * and every later one came out complete. Measured before the limit was
 * lifted: `const x: number = 1; // c` returned 3, then 6, then 8, 9 and 10
 * style spans across five consecutive calls, and between two and five of
 * the thirty languages below disagreed with themselves run to run. The
 * output depended on how warm the process was, which is exactly the
 * property a cache must not have.
 *
 * `tokenizeTimeLimit: 0` removes the limit. With it removed, all thirty
 * languages tokenise identically on every call and byte-identically to the
 * WebAssembly Oniguruma engine's own output — which is the independent
 * check that lifting the limit restores the *correct* tokenisation rather
 * than merely a consistent one.
 *
 * The limit exists as a guard against a pathological line, so removing it
 * means replacing it. `tokenizeMaxLineLength` is that replacement:
 * VS Code's own `editor.maxTokenizationLineLength`, 20 000 characters,
 * beyond which a line is left untokenised. It bounds the same risk by the
 * *input* rather than by the clock, so it cannot make two renders of one
 * document disagree.
 *
 * ## The cost, measured on this host (Bun 1.4.2)
 *
 * | Cost | Measurement |
 * | --- | --- |
 * | Importing the thirty grammar modules below | ~180 ms, ~20 MB RSS, once per process, at module load |
 * | Building the highlighter | ~80 ms, once, on the first highlighted fence |
 * | Compiling one grammar | 0–300 ms, once per language a document actually uses |
 * | Highlighting | ~1.7 ms per line of code |
 *
 * All of it is paid lazily: a process that renders no fenced code past the
 * import never builds a highlighter at all. And none of it reaches a
 * browser — `packages/markdown`'s `"."` barrel is imported by
 * `packages/db` and `apps/api` only, and `packages/editor` imports the
 * crypto-free, highlighter-free `"./pipeline"` export instead (that split
 * is why `pipeline.ts` exists — see its header). `render()` stays
 * synchronous: the JavaScript regex engine needs no WebAssembly load, and
 * with the time limit lifted it agrees with the WebAssembly engine
 * token for token.
 *
 * ## What is deliberately NOT highlighted
 *
 * A fence with no info string, and one naming a language not in
 * `LANGUAGE_MODULES`, render exactly as they did before this file existed:
 * `undefined` comes back and `render()` falls through to
 * `mdast-util-to-hast`'s own `code` handler. That covers the diagram fences
 * (`mermaid`, `d2` — docs/SPECS.md §6), whose content is a *source* a
 * diagram renderer will consume rather than prose to colour, and it covers
 * the next language nobody thought of. No guessing, no crash.
 */
import type { Element, ElementContent, Root } from 'hast';
import type { HighlighterCore, LanguageRegistration } from '@shikijs/types';
import { createCssVariablesTheme, createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import c from '@shikijs/langs/c';
import cpp from '@shikijs/langs/cpp';
import csharp from '@shikijs/langs/csharp';
import css from '@shikijs/langs/css';
import diff from '@shikijs/langs/diff';
import dockerfile from '@shikijs/langs/dockerfile';
import go from '@shikijs/langs/go';
import graphql from '@shikijs/langs/graphql';
import hcl from '@shikijs/langs/hcl';
import html from '@shikijs/langs/html';
import ini from '@shikijs/langs/ini';
import java from '@shikijs/langs/java';
import javascript from '@shikijs/langs/javascript';
import json from '@shikijs/langs/json';
import jsx from '@shikijs/langs/jsx';
import kotlin from '@shikijs/langs/kotlin';
import markdown from '@shikijs/langs/markdown';
import php from '@shikijs/langs/php';
import python from '@shikijs/langs/python';
import ruby from '@shikijs/langs/ruby';
import rust from '@shikijs/langs/rust';
import shellscript from '@shikijs/langs/shellscript';
import sql from '@shikijs/langs/sql';
import swift from '@shikijs/langs/swift';
import toml from '@shikijs/langs/toml';
import tsx from '@shikijs/langs/tsx';
import typescript from '@shikijs/langs/typescript';
import vue from '@shikijs/langs/vue';
import xml from '@shikijs/langs/xml';
import yaml from '@shikijs/langs/yaml';

/**
 * The languages this product highlights. Each entry is one
 * `@shikijs/langs/*` module — an array of TextMate grammars: the language
 * itself plus whatever it embeds (`vue` carries seventeen, because a `.vue`
 * file embeds HTML, CSS, TypeScript and the rest).
 *
 * To add one, add the import and the entry; nothing else in this file is
 * per-language. Aliases come from the grammars themselves (`ts`, `bash`,
 * `yml`, `py`, `rb`, …) and are indexed below rather than restated here, so
 * a grammar that gains an alias upstream gains it here too.
 */
const LANGUAGE_MODULES: readonly LanguageRegistration[][] = [
  typescript,
  tsx,
  javascript,
  jsx,
  json,
  yaml,
  toml,
  ini,
  shellscript,
  sql,
  python,
  go,
  rust,
  java,
  csharp,
  kotlin,
  swift,
  c,
  cpp,
  php,
  ruby,
  html,
  css,
  vue,
  markdown,
  diff,
  dockerfile,
  graphql,
  xml,
  hcl,
];

/**
 * Every id a fence may spell — each grammar's `name` and every `aliases`
 * entry it declares — mapped to the module that must be compiled to serve
 * it. Built without compiling anything: a registration is a plain object,
 * and reading two of its fields costs nothing. First declaration wins,
 * which matters only for a grammar that appears in two modules (`css` is
 * its own module and also one of `vue`'s seventeen); either module
 * registers it, so the tie is free.
 */
const MODULE_BY_LANGUAGE_ID: ReadonlyMap<string, LanguageRegistration[]> = (() => {
  const index = new Map<string, LanguageRegistration[]>();
  for (const module of LANGUAGE_MODULES) {
    for (const grammar of module) {
      for (const id of [grammar.name, ...(grammar.aliases ?? [])]) {
        if (!index.has(id)) index.set(id, module);
      }
    }
  }
  return index;
})();

/**
 * The token kinds `createCssVariablesTheme` can emit, verbatim from its own
 * `variable('token-…')` calls (`@shikijs/core`'s css-variables theme). This
 * being a **closed** set is the property the sanitiser allowlist rests on:
 * `render()` admits exactly `hl-line` plus `hl-<kind>` for these kinds and
 * nothing else, so no `class` a highlighter run can produce is open-ended.
 */
const TOKEN_KINDS = [
  'changed',
  'comment',
  'constant',
  'deleted',
  'function',
  'inserted',
  'keyword',
  'link',
  'parameter',
  'punctuation',
  'string',
  'string-expression',
] as const;

/** The class marking one source line, so a stylesheet can address a line without addressing a token. */
export const HIGHLIGHT_LINE_CLASS = 'hl-line';

/**
 * Every class name a highlighted fence can carry — the exact allowlist
 * `render()`'s sanitiser schema admits on a `<span>`, and the exact set
 * `apps/web/app/assets/css/main.css` gives a colour to. A name outside this
 * list cannot reach a reader's DOM, whatever a future Shiki release decides
 * to emit.
 */
export const HIGHLIGHT_CLASSES: readonly string[] = [HIGHLIGHT_LINE_CLASS, ...TOKEN_KINDS.map((kind) => `hl-${kind}`)];

/**
 * The CSS-variable prefix asked of Shiki. It never reaches the output —
 * `classFor` below translates every one of these into a class and drops the
 * `style` that carried it — so the prefix is private to this file and
 * exists only to be pattern-matched back out.
 */
const VARIABLE_PREFIX = '--dw-hl-';
const TOKEN_STYLE = new RegExp(`^color:var\\(${VARIABLE_PREFIX}(?:token-)?([a-z-]+)\\)$`);

const THEME_NAME = 'deep-wiki-css-variables';

/**
 * `fontStyle: false`: the theme emits colour and nothing else. Italic
 * comments would arrive as `font-style` inside the same `style` attribute,
 * which would need either its own class in the vocabulary above or a second
 * allowance in the sanitiser — a decision about type, made by a
 * highlighter, inside a document whose type scale is
 * docs/DESIGN-SYSTEM.md §2.3's. Colour is the only axis a highlighter owns
 * here.
 *
 * `variableDefaults: {}`: no fallback colours are inlined into the theme,
 * because nothing downstream ever reads the variables — they are matched
 * back out and replaced by classes before the HTML is built.
 */
const THEME = createCssVariablesTheme({
  name: THEME_NAME,
  variablePrefix: VARIABLE_PREFIX,
  variableDefaults: {},
  fontStyle: false,
});

/**
 * How a block is tokenised, stated here rather than left to Shiki's
 * defaults — see the header. `tokenizeTimeLimit: 0` is what makes a render
 * a function of its input alone; `tokenizeMaxLineLength` is the guard that
 * takes over the job the time limit was doing, bounded by the input
 * instead of by the clock (VS Code's own
 * `editor.maxTokenizationLineLength`).
 */
const TOKENIZE_OPTIONS = { theme: THEME_NAME, tokenizeTimeLimit: 0, tokenizeMaxLineLength: 20_000 } as const;

/**
 * One highlighter per process, built on first use and never rebuilt: Shiki
 * itself warns at ten live instances, and each costs the engine's ~80 ms.
 * Grammars are compiled into it one module at a time, the first time a
 * fence names one of their languages.
 */
let highlighter: HighlighterCore | undefined;
const compiled = new WeakSet<LanguageRegistration[]>();

function highlighterWith(module: LanguageRegistration[]): HighlighterCore {
  highlighter ??= createHighlighterCoreSync({ langs: [], themes: [THEME], engine: createJavaScriptRegexEngine() });
  if (!compiled.has(module)) {
    highlighter.loadLanguageSync(module);
    compiled.add(module);
  }
  return highlighter;
}

/** Whether a fence's info string names a language this build can highlight. */
export function isHighlightableLanguage(lang: string | null | undefined): boolean {
  return lang ? MODULE_BY_LANGUAGE_ID.has(lang.toLowerCase()) : false;
}

/**
 * The class a token span carries, or `undefined` when the span carries no
 * meaning worth keeping — the theme's plain foreground, or a shape this
 * file does not recognise. Both are unwrapped rather than emitted as a bare
 * `<span>`: the sanitiser would strip an unknown class anyway, and
 * `dropEmptiedClassName` would leave the empty element behind.
 */
function classFor(style: unknown): string | undefined {
  if (typeof style !== 'string') return undefined;
  const kind = TOKEN_STYLE.exec(style)?.[1];
  if (!kind) return undefined;
  return (TOKEN_KINDS as readonly string[]).includes(kind) ? `hl-${kind}` : undefined;
}

/** Replaces each token span with either a classed span or, where the span means nothing, its own children. */
function rewriteTokens(children: readonly ElementContent[]): ElementContent[] {
  return children.flatMap((child): ElementContent[] => {
    if (child.type !== 'element' || child.tagName !== 'span') return [child];
    const className = classFor(child.properties.style);
    if (!className) return rewriteTokens(child.children);
    return [{ ...child, properties: { className: [className] }, children: rewriteTokens(child.children) }];
  });
}

/**
 * The `<code>`'s own children: one span per source line (Shiki's
 * `class="line"`, renamed into this file's single `hl-` namespace) with the
 * newline text nodes between them left exactly as they are — a `<pre>`'s
 * whitespace is its content.
 */
function rewriteLines(children: readonly ElementContent[]): ElementContent[] {
  return children.map((child) =>
    child.type === 'element' && child.tagName === 'span'
      ? ({
          type: 'element',
          tagName: 'span',
          properties: { className: [HIGHLIGHT_LINE_CLASS] },
          children: rewriteTokens(child.children),
        } satisfies Element)
      : child,
  );
}

/**
 * Highlights one fenced block, or returns `undefined` when its language is
 * absent or unknown so the caller can render it exactly as before.
 *
 * The returned element is the `<pre>` Shiki built, stripped back to this
 * product's own output shape: no `style` (the colours are classes now), no
 * `tabindex` (Shiki adds one so its scroll box is keyboard reachable;
 * `.doc-body pre` has been a scroll box without one since before this file,
 * and adding a tab stop to every code block on a page is a change to the
 * read screen's focus order, not a highlighting decision), and
 * `<code class="language-<lang>">` spelled exactly as the fence spelled it
 * — byte-identical to the unhighlighted output, so the only difference
 * highlighting makes to a cached page is the token spans inside.
 */
export function highlightToHast(code: string, lang: string | null | undefined): Element | undefined {
  if (!lang) return undefined;
  const id = lang.toLowerCase();
  const module = MODULE_BY_LANGUAGE_ID.get(id);
  if (!module) return undefined;

  const root: Root = highlighterWith(module).codeToHast(code, { ...TOKENIZE_OPTIONS, lang: id });
  const pre = root.children.find((child): child is Element => child.type === 'element' && child.tagName === 'pre');
  const codeElement = pre?.children.find((child): child is Element => child.type === 'element' && child.tagName === 'code');
  if (!codeElement) return undefined;

  return {
    type: 'element',
    tagName: 'pre',
    properties: {},
    children: [
      {
        type: 'element',
        tagName: 'code',
        properties: { className: [`language-${lang}`] },
        // The trailing newline `mdast-util-to-hast`'s own handler appends
        // (`node.value + '\n'`). Shiki does not emit one, and without it a
        // highlighted block and an unhighlighted one on the same page
        // would differ by a line box — a geometry change nobody asked for,
        // arriving with a colour change somebody did.
        children: [...rewriteLines(codeElement.children), { type: 'text', value: '\n' }],
      },
    ],
  };
}
