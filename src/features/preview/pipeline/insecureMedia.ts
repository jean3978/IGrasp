// Plain-http media is not loaded (privacy, mixed content). Before sanitization, move such a
// `src` to `data-blocked` so the preview can show why the image or video is missing.

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';

const MEDIA = new Set(['img', 'video', 'source']);

export function rehypeMarkInsecureMedia() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (!MEDIA.has(node.tagName)) return;
      for (const prop of ['src', 'poster'] as const) {
        const value = node.properties[prop];
        if (typeof value === 'string' && /^http:/i.test(value.trim())) {
          node.properties[prop] = undefined;
          if (prop === 'src') node.properties.dataBlocked = value;
        }
      }
    });
  };
}
