/**
 * Shared non-disclosure assertion (content-and-editor design.md "Listing
 * without disclosure" — "Tests assert this from the unauthorised subject's
 * point of view with one shared helper"). Scans the serialised response
 * body for a hidden node's id, slug, or title; throws (failing the calling
 * test) if any of them leaked, regardless of where in the shape they would
 * have appeared.
 */
export interface HiddenNode {
  readonly id: string;
  readonly slug?: string;
  readonly title?: string;
}

export function expectNoDisclosure(body: unknown, hidden: HiddenNode): void {
  const serialised = JSON.stringify(body);

  if (serialised.includes(hidden.id)) {
    throw new Error(`disclosure: response body contains the hidden node's id (${hidden.id})`);
  }
  if (hidden.slug && serialised.includes(hidden.slug)) {
    throw new Error(`disclosure: response body contains the hidden node's slug (${hidden.slug})`);
  }
  if (hidden.title && serialised.includes(hidden.title)) {
    throw new Error(`disclosure: response body contains the hidden node's title (${hidden.title})`);
  }
}
