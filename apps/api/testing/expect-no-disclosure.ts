/**
 * Shared non-disclosure assertion (content-and-editor design.md "Listing
 * without disclosure" — "Tests assert this from the unauthorised subject's
 * point of view with one shared helper"). Scans everything the response
 * actually puts on the wire — the serialised body **and** the headers,
 * names as well as values — for a hidden node's id, slug, title, or any
 * other value the caller names; throws (failing the calling test) if any
 * of them leaked, regardless of where in the shape they would have
 * appeared.
 *
 * `headers` is required rather than optional on purpose: an optional
 * channel is one a call site can silently skip, which is the same defect
 * class as the leak this helper exists to catch.
 */
export interface HiddenNode {
  readonly id: string;
  readonly slug?: string;
  readonly title?: string;
  /**
   * Anything else that must not reach the caller and is not an id, slug or
   * title — a comment count, an excerpt, a header name that only exists
   * when the hidden thing does.
   */
  readonly values?: readonly string[];
}

/** Anything a route test has to hand: `res.headers`, or a plain record. */
export type ResponseHeaders = Headers | Readonly<Record<string, string>> | Iterable<readonly [string, string]>;

function serialiseHeaders(headers: ResponseHeaders): string {
  const entries: [string, string][] = [];
  if (headers instanceof Headers) {
    headers.forEach((value, name) => entries.push([name, value]));
  } else if (Symbol.iterator in Object(headers)) {
    for (const [name, value] of headers as Iterable<readonly [string, string]>) entries.push([name, value]);
  } else {
    for (const [name, value] of Object.entries(headers as Record<string, string>)) entries.push([name, value]);
  }
  // Names are scanned as well as values: `x-page-<id>: 1` leaks just as
  // surely as `x-node-id: <id>`.
  return entries.map(([name, value]) => `${name}: ${value}`).join('\n');
}

export function expectNoDisclosure(body: unknown, hidden: HiddenNode, headers: ResponseHeaders): void {
  const serialisedBody = typeof body === 'string' ? body : JSON.stringify(body);
  const serialisedHeaders = serialiseHeaders(headers);

  const secrets: [string, string][] = [['id', hidden.id]];
  if (hidden.slug) secrets.push(['slug', hidden.slug]);
  if (hidden.title) secrets.push(['title', hidden.title]);
  for (const value of hidden.values ?? []) secrets.push(['value', value]);

  for (const [label, secret] of secrets) {
    if (serialisedBody.includes(secret)) {
      throw new Error(`disclosure: response body contains the hidden node's ${label} (${secret})`);
    }
    if (serialisedHeaders.includes(secret)) {
      throw new Error(`disclosure: a response header contains the hidden node's ${label} (${secret})`);
    }
  }
}
