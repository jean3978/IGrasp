// Removes the YAML front matter node and stores its parsed value in `file.data.frontMatter`.

import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import { parse } from 'yaml';

export interface FrontMatter {
  raw: string;
  /** Parsed value; null when the YAML is invalid or empty. */
  data: unknown;
  error: string | null;
}

declare module 'vfile' {
  interface DataMap {
    frontMatter: FrontMatter;
  }
}

export function remarkExtractFrontMatter() {
  return (tree: Root, file: VFile) => {
    const first = tree.children[0];
    if (first?.type !== 'yaml') return;
    tree.children.shift();
    try {
      file.data.frontMatter = {
        raw: first.value,
        data: parse(first.value) as unknown,
        error: null,
      };
    } catch (err) {
      file.data.frontMatter = {
        raw: first.value,
        data: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
