import type { Node } from 'mdast';

export function identity(node: Node): Node {
  return node;
}
