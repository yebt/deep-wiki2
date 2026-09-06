import { toHtml } from 'hast-util-to-html';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';

/**
 * The URL-scheme allowlist for `link`/`image` targets (`href`/`src`),
 * stated explicitly rather than left to the sanitiser's own defaults — "a
 * rule with no mechanism is advice" (scripts/checks/single-parser.ts
 * carries the same principle for the parser rule). `javascript:` and
 * `data:` are excluded outright: neither is a legitimate target for
 * content a workspace member writes.
 */
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto'],
    src: ['http', 'https'],
  },
};

const renderProcessor = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeSanitize, SANITIZE_SCHEMA);

/**
 * Renders canonical Markdown to sanitised HTML for the read-mode cache.
 * Sanitising happens here — at render time — never at save (design.md D12,
 * threat matrix: executable-file/active-content classification): the
 * stored Markdown keeps a raw `<script>` or `onerror` attribute byte for
 * byte, exactly as GATE-2 requires, and this function is what stands
 * between that stored content and a browser.
 */
export function render(markdown: string): string {
  const hast = renderProcessor.runSync(renderProcessor.parse(markdown));
  return toHtml(hast);
}
