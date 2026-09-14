import { diffBlocks } from '@deep-wiki/markdown';
import { loadAnchors } from './anchors';

export function run(a: never, b: never) {
  return diffBlocks(loadAnchors(a), loadAnchors(b));
}
